const Web3 = require('web3')
const { toBN, toWei, fromWei } = Web3.utils
const axios = require('axios')
const Addresses = require("./Addresses.js")
//const { getPrice, getEthPrice, getCTokenPriceFromZapper } = require('./priceFetcher')
const User = require("./User.js")
const { waitForCpuToGoBelowThreshold } = require("../machineResources")
const { retry } = require("../utils")
const { assert } = require('console')
const coinGeckoIDs = require("./utils/coingeckoIDs.json")


class MaiParser {
    constructor(maiInfo, network, web3, heavyUpdateInterval = 24) {
        this.web3 = web3
        this.heavyUpdateInterval = heavyUpdateInterval

        this.tvl = toBN("0")
        this.totalBorrows = toBN("0")

        this.vault = new web3.eth.Contract(Addresses.maiVaultAbi, maiInfo.address)
        this.multicallSize = maiInfo.multicallSize
        this.multicall = new web3.eth.Contract(Addresses.multicallAbi, Addresses.multicallAddress[network])

        this.mainCntr = 0

        this.price = toBN(0)

        this.userDebt = {}
        this.userCollateral = {}

        this.feedDecimals = 0
        this.tokenDecimals = 0

        this.network = network

        this.output = {}
    }

    async heavyUpdate() {
        await this.initPrices()
        await this.updateAllUsers()
    }

    async main(onlyOnce = false) {
        try {
            await waitForCpuToGoBelowThreshold()
            const currBlock = await this.web3.eth.getBlockNumber() - 10
            const currTime = (await this.web3.eth.getBlock(currBlock)).timestamp

            console.log("heavyUpdate start")
            await this.heavyUpdate()
            console.log('heavyUpdate success')
            console.log("calc bad debt")
            await this.calcBadDebt(currTime)

            this.lastUpdateBlock = currBlock

            // don't  increase cntr, this way if heavy update is needed, it will be done again next time
            console.log("sleeping", this.mainCntr++)
        }

        catch (err) {
            console.log("main failed", { err })
        }

        if (onlyOnce) {
            return Number(fromWei(this.sumOfBadDebt.toString()))
        }

        setTimeout(this.main.bind(this), 1000 * 60 * 60 * 2) // sleep for 2 hours
    }

    async initPrices() {
        console.log("getting prices")
        try {
            if (this.network === "ergererbteb")
                try {
                    const tokenAddress = await this.vault.methods.collateral().call();
                    const token = new this.web3.eth.Contract(Addresses.erc20Abi, tokenAddress)
                    this.tokenDecimals = await token.methods.decimals().call();
                    const tokenSymbol = await token.methods.symbol().call();
                    console.log("tokenSymbol", tokenSymbol);


                    ///Oracle price
                    let oraclePrice = await this.vault.methods.getEthPriceSource().call();
                    oraclePrice = toBN(oraclePrice).mul(toBN(1000));
                    this.feedDecimals = await this.vault.methods.priceSourceDecimals().call();
                    const priceFeedDecimalsFactor = toBN(10).pow(toBN(this.feedDecimals));
                    oraclePrice = oraclePrice.div(priceFeedDecimalsFactor);
                    oraclePrice = oraclePrice.toNumber() / 1000;
                    console.log("oracle price:", oraclePrice);


                    //Fantom Price
                    let oneInchFantomPrice = 0;
                    oneInchFantomPrice = await axios.get(`https://api-bprotocol.1inch.io/v5.2/250/quote?src=0x04068DA6C83AFCFA0e13ba15A6696662335D5B75&dst=${tokenAddress}&amount=1000000000`);
                    const decimalsFactor = toBN("10").pow(toBN(this.tokenDecimals))
                    oneInchFantomPrice = toBN(oneInchFantomPrice.data.toAmount).mul(toBN(1000)).div(decimalsFactor);
                    oneInchFantomPrice = 1000 / (oneInchFantomPrice.toNumber() / 1000);
                    console.log("1inch FTM price:", oneInchFantomPrice);


                    ///Mainstream price
                    const geckoID = coinGeckoIDs[tokenSymbol];
                    let mainstreamPrice = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${geckoID}&vs_currencies=usd`)
                    mainstreamPrice = mainstreamPrice.data[geckoID]["usd"];
                    console.log("mainstream price (coingecko):", mainstreamPrice)


                    console.log("1inch / mainstream", mainstreamPrice / oneInchFantomPrice);
                    const finalPrice = oraclePrice * mainstreamPrice / oneInchFantomPrice;
                    console.log("final price", finalPrice);
                    this.price = toBN((finalPrice * 10000).toFixed()).mul(priceFeedDecimalsFactor).div(toBN(10000));
                    console.log('logged price', this.price.toNumber())
                    return
                }
                catch {
                    this.price = await this.vault.methods.getEthPriceSource().call()
                }
                this.price = await this.vault.methods.getEthPriceSource().call()

        }
        catch (err) {
            if (err.toString().includes("Error: Returned error: execution reverted")) {
                this.price = 0
            }
            else {
                console.log("should revert")
                throw new Error(err)
            }
        }
        console.log(this.price)

        const rawTokenVaults = [
            "0x88d84a85A87ED12B8f098e8953B322fF789fCD1a",
            "0xa3Fa99A148fA48D14Ed51d610c367C61876997F1"
        ]

        if (this.network === "MATIC" && rawTokenVaults.includes(this.vault.options.address)) {
            this.feedDecimals = 8
            this.tokenDecimals = 18
            return
        }

        if (this.network === "MATIC" && this.vault.options.address === "0x7dDA5e1A389E0C1892CaF55940F5fcE6588a9ae0") {
            this.feedDecimals = 8
            this.tokenDecimals = 8
            return
        }

        console.log("get collateral decimals")
        try {
            this.feedDecimals = await this.vault.methods.collateralDecimals().call()
        }
        catch (err) {
            this.feedDecimals = await this.vault.methods.priceSourceDecimals().call()
        }
        console.log("get collateral")
        const tokenAddress = await this.vault.methods.collateral().call()

        const token = new this.web3.eth.Contract(Addresses.erc20Abi, tokenAddress)
        this.tokenDecimals = await token.methods.decimals().call()

        console.log('test', this.price)
        let oraclePrice = toBN(this.price).mul(toBN(10));
        const priceFeedDecimalsFactor = toBN(10).pow(toBN(this.feedDecimals));
        oraclePrice = oraclePrice.div(priceFeedDecimalsFactor);
        console.log('testing', oraclePrice.toNumber());
        oraclePrice = oraclePrice.toNumber() / 10;
        console.log("oracle price:", oraclePrice);
    }

    async updateAllUsers() {
        const lastVault = await this.vault.methods.vaultCount().call()
        console.log({ lastVault })

        const users = []
        for (let i = 0; i <= Number(lastVault); i++) {
            users.push(i)
        }

        const bulkSize = this.multicallSize
        for (let i = 0; i < users.length; i += bulkSize) {
            const start = i
            const end = i + bulkSize > users.length ? users.length : i + bulkSize
            console.log("update", i.toString() + " / " + users.length.toString())
            try {
                await this.updateUsers(users.slice(start, end))
            }
            catch (err) {
                console.log("update user failed, trying again", err)
                i -= bulkSize
            }
        }
    }

    async calcBadDebt(currTime) {
        this.sumOfBadDebt = this.web3.utils.toBN("0")
        let deposits = this.web3.utils.toBN("0")
        let borrows = this.web3.utils.toBN("0")
        let tvl = this.web3.utils.toBN("0")

        const userWithBadDebt = []

        //console.log(this.users)
        const users = Object.keys(this.userCollateral)
        for (const user of users) {
            const debt = toBN(this.userDebt[Number(user)])

            const decimalsFactor = toBN("10").pow(toBN(18 - this.tokenDecimals))
            const priceFeedDecimalsFactor = toBN(10).pow(toBN(this.feedDecimals))

            const collateralValue = toBN(this.userCollateral[user]).mul(toBN(this.price)).mul(decimalsFactor).div(priceFeedDecimalsFactor)
            //console.log(user.toString() + ")", fromWei(collateralValue), this.price.toString(), this.userCollateral[user])

            if (collateralValue.lt(debt)) {
                this.sumOfBadDebt = this.sumOfBadDebt.add(collateralValue.sub(debt))
                userWithBadDebt.push({ "user": user, "badDebt": (collateralValue.sub(debt)).toString() })
            }

            tvl = tvl.add(collateralValue)
            deposits = deposits.add(collateralValue)
            borrows = borrows.add(debt)
        }

        this.tvl = tvl

        this.output = {
            "total": this.sumOfBadDebt.toString(), "updated": currTime.toString(), "decimals": "18", "users": userWithBadDebt,
            "tvl": this.tvl.toString(), "deposits": deposits.toString(), "borrows": borrows.toString(),
            "calculatedBorrows": this.totalBorrows.toString(),
            "name": this.name
        }

        console.log(JSON.stringify(this.output))

        console.log("total bad debt", this.sumOfBadDebt.toString(), { currTime })

        return this.sumOfBadDebt
    }

    async updateUsers(users) {
        console.log("updateUsers")
        // need to get: 1) urns
        const collateralCalls = []
        const debtCalls = []
        for (let i of users) {
            const colCall = {}
            colCall["target"] = this.vault.options.address
            colCall["callData"] = this.vault.methods.vaultCollateral(i).encodeABI()
            collateralCalls.push(colCall)


            const debCall = {}
            debCall["target"] = this.vault.options.address
            debCall["callData"] = this.vault.methods.vaultDebt(i).encodeABI()
            debtCalls.push(debCall)
        }

        console.log("getting collateral data")
        const colCallResults = await this.multicall.methods.tryAggregate(false, collateralCalls).call()
        console.log("getting debt data")
        const debtCallResults = await this.multicall.methods.tryAggregate(false, debtCalls).call()

        for (let i = 0; i < users.length; i++) {
            const col = this.web3.eth.abi.decodeParameter("uint256", colCallResults[i].returnData)
            const debt = this.web3.eth.abi.decodeParameter("uint256", debtCallResults[i].returnData)

            this.userCollateral[users[i]] = col
            this.userDebt[users[i]] = debt
        }
    }
}

module.exports = MaiParser

async function test() {
    //ckey_2d9319e5566c4c63b7b62ccf862"

    const web3 = new Web3("https://rpc.ftm.tools")

    const maiInfo = {
        "multicallSize": 1000,
        "address": "0xa3Fa99A148fA48D14Ed51d610c367C61876997F1"
    }

    const addresses = [
        // "0x1066b8FC999c1eE94241344818486D5f944331A0",
        // "0xD939c268C49c442F037E968F045ba02f499562D4",
        // "0x7efB260662a6FA95c1CE1092c53Ca23733202798",
        // "0x682E473FcA490B0adFA7EfE94083C1E63f28F034",
        // "0x7aE52477783c4E3e5c1476Bbb29A8D029c920676",
        // "0x571F42886C31f9b769ad243e81D06D0D144BE7B4",
        // "0x6d6029557a06961aCC5F81e1ffF5A474C54e32Fd",
        // "0xE5996a2cB60eA57F03bf332b5ADC517035d8d094",
        // "0xd6488d586E8Fcd53220e4804D767F19F5C846086",
        // "0x267bDD1C19C932CE03c7A62BBe5b95375F9160A6",
        // "0xdB09908b82499CAdb9E6108444D5042f81569bD9",
        // "0x3609A304c6A41d87E895b9c1fd18c02ba989Ba90",
        // "0xC1c7eF18ABC94013F6c58C6CdF9e829A48075b4e",
        "0x5563Cc1ee23c4b17C861418cFF16641D46E12436",
        "0x8e5e4D08485673770Ab372c05f95081BE0636Fa2",
        "0xBf0ff8ac03f3E0DD7d8faA9b571ebA999a854146",
        "0xf34e271312e41bbd7c451b76af2af8339d6f16ed",
        "0x9ba01b1279b1f7152b42aca69faf756029a9abde",
        "0x75d4ab6843593c111eeb02ff07055009c836a1ef",
        "0x3f6cf10e85e9c0630856599FAB8D8BFcd9C0E7D4"
    ]

    let badDebt = 0.0

    for (const addr of addresses) {
        maiInfo["address"] = addr

        console.log({ maiInfo })

        const mai = new MaiParser(maiInfo, "FTM", web3)
        badDebt += await mai.main(true)

        console.log({ badDebt })
    }

}

test()
