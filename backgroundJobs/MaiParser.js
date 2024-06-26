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
const { uploadJsonFile } = require('../githubClient.js')
const { execSync } = require('child_process')

const getDay = () => {
    const dateObj = new Date();
    const month = dateObj.getUTCMonth() + 1; //months from 1-12
    const day = dateObj.getUTCDate();
    const year = dateObj.getUTCFullYear();
    return day + '.' + month + '.' + year
  }
  
class MaiParser {
    constructor(sending, maiInfo, network, name, web3, geckoFTMPrice, heavyUpdateInterval = 24) {
        this.web3 = web3
        this.heavyUpdateInterval = heavyUpdateInterval
        this.geckoFTMPrice = geckoFTMPrice;

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
        this.networkName = name

        this.output = {}
        this.sumOfBorrows = 0;
        this.sending = sending;
        this.BeefyVaultFactoring = undefined;

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
            console.log("returned .....", this.sumOfBorrows);
            return Number(this.sumOfBorrows);
        }

        setTimeout(this.main.bind(this), 1000 * 60 * 60 * 2) // sleep for 2 hours
    }

    async initPrices() {
        console.log("getting prices")
        try {
            if (this.network === "FTM")
                try {
                    let tokenAddress = await this.vault.methods.collateral().call();
                    const token = new this.web3.eth.Contract(Addresses.erc20Abi, tokenAddress)
                    this.tokenDecimals = await token.methods.decimals().call();
                    const tokenSymbol = await token.methods.symbol().call();
                    console.log("tokenSymbol", tokenSymbol);

                    /// yvAssets addresses translator
                    const yvTranslation = {
                        '0x0DEC85e74A92c52b7F708c4B10207D9560CEFaf0': "0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83",
                        '0x637eC617c86D24E421328e6CAEa1d92114892439': "0x8D11eC38a3EB5E956B052f67Da8Bdc9bef8Abf3E",
                        '0xCe2Fc0bDc18BD6a4d9A725791A3DEe33F3a23BB7': "0x74b23882a30290451A17c44f4F05243b6b58C76d",
                        '0xd817A100AB8A29fE3DBd925c2EB489D67F758DA9': "0x321162Cd933E2Be498Cd2267a90534A804051b11",
                        '0x2C850cceD00ce2b14AA9D658b7Cad5dF659493Db': "0x29b0Da86e484E1C0029B56e817912d778aC0EC69"
                    }
                    const mooTranslation = {
                        "0x49c68eDb7aeBd968F197121453e41b8704AcdE0C": "0x321162Cd933E2Be498Cd2267a90534A804051b11",
                        "0x0a03D2C1cFcA48075992d810cc69Bd9FE026384a": "0x74b23882a30290451A17c44f4F05243b6b58C76d",
                        "0x97927aBfE1aBBE5429cBe79260B290222fC9fbba": "0x321162Cd933E2Be498Cd2267a90534A804051b11",
                        "0x6DfE2AAEA9dAadADf0865B661b53040E842640f8": "0xb3654dc3D10Ea7645f8319668E8F54d2574FBdC8",
                        "0x920786cff2A6f601975874Bb24C63f0115Df7dc8": "0x8d11ec38a3eb5e956b052f67da8bdc9bef8abf3e",
                        "0xA3e3Af161943CfB3941B631676134bb048739727": "0xfdb9ab8b9513ad9e419cf19530fee49d412c3ee3",
                        "0x9ba01b1279b1f7152b42aca69faf756029a9abde": "0xf0702249F4D3A25cD3DED7859a165693685Ab577",
                        "0xbF07093ccd6adFC3dEB259C557b61E94c1F66945": "0xd6070ae98b8069de6B494332d1A1a81B6179D960",
                    }

                    //if MooToken
                    if (mooTranslation[tokenAddress]) {
                        console.log("MooScreamFTM token detected");
                        try {
                            /// if it's the MooScreamFTM, needs native BeefyVaultABI
                            if (tokenAddress === "0x49c68eDb7aeBd968F197121453e41b8704AcdE0C") {
                                /// get price of collateral token in FTM
                                const collateralContract = new this.web3.eth.Contract(Addresses.beefyVaultV6NativeABI, tokenAddress);
                                let mooScreamFTMPrice = await collateralContract.methods.getPricePerFullShare().call();
                                this.feedDecimals = await collateralContract.methods.decimals().call();
                                const priceFeedDecimalsFactor = toBN(10).pow(toBN(this.feedDecimals));
                                mooScreamFTMPrice = toBN(mooScreamFTMPrice).div(priceFeedDecimalsFactor);
                                mooScreamFTMPrice = mooScreamFTMPrice.toNumber() * this.geckoFTMPrice;
                                this.price = toBN((mooScreamFTMPrice * 10000).toFixed()).mul(priceFeedDecimalsFactor).div(toBN(10000));

                                console.log("MooScreamFTM price set at", this.price.toString());
                                return
                            }
                            if(mooTranslation[tokenAddress]){
                            const collateralContract = new this.web3.eth.Contract(Addresses.beefyVaultV6ABI, tokenAddress);
                                this.feedDecimals = await collateralContract.methods.decimals().call();
                                const priceFeedDecimalsFactor = toBN(10).pow(toBN(this.feedDecimals));
                                let mooTokenPriceInWant = await collateralContract.methods.getPricePerFullShare().call();
                                mooTokenPriceInWant = toBN(mooTokenPriceInWant).div(priceFeedDecimalsFactor);
                            const want = await collateralContract.methods.want().call();                            
                            this.BeefyVaultFactoring = mooTokenPriceInWant.toNumber();
                            tokenAddress = want;
                        }
                        }
                        catch (err) {
                            console.log(err)
                        }
                    }



                    if (yvTranslation[tokenAddress]) {
                        tokenAddress = yvTranslation[tokenAddress];
                    }

                    console.log('token address', tokenAddress);

                    ///Oracle price
                    let oraclePrice = await this.vault.methods.getEthPriceSource().call();
                    oraclePrice = toBN(oraclePrice).mul(toBN(10000));
                    this.feedDecimals = await this.vault.methods.priceSourceDecimals().call();
                    if(tokenAddress === "0x321162Cd933E2Be498Cd2267a90534A804051b11"){
                        this.feedDecimals = 8;
                        this.tokenDecimals = 8;
                    }
                    const priceFeedDecimalsFactor = toBN(10).pow(toBN(this.feedDecimals));
                    oraclePrice = oraclePrice.div(priceFeedDecimalsFactor);
                    oraclePrice = oraclePrice.toNumber() / 10000;
                    console.log("oracle price:", oraclePrice);


                    //Fantom Price
                    let oneInchFantomPrice = 0;

                        oneInchFantomPrice = await axios.get(`https://api-bprotocol.1inch.io/v5.2/250/quote?src=0x82f0B8B456c1A451378467398982d4834b6829c1&dst=${tokenAddress}&amount=1000000000000000000000`);

                    const decimalsFactor = toBN("10").pow(toBN(this.tokenDecimals))
                    oneInchFantomPrice = toBN(oneInchFantomPrice.data.toAmount).mul(toBN(1000)).div(decimalsFactor);
                    oneInchFantomPrice = oneInchFantomPrice.toNumber() / 1000;
                    oneInchFantomPrice = (1000 / oneInchFantomPrice);
                    console.log("1inch FTM price:", oneInchFantomPrice);


                    ///Mainstream price
                    const geckoID = coinGeckoIDs[tokenSymbol];
                    let mainstreamPrice = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${geckoID}&vs_currencies=usd`)
                    mainstreamPrice = mainstreamPrice.data[geckoID]["usd"];
                    console.log("mainstream price (coingecko):", mainstreamPrice)


                    console.log("mainstream / 1inch", oneInchFantomPrice / mainstreamPrice);
                    let finalPrice = oraclePrice * oneInchFantomPrice / mainstreamPrice;
                    if (this.BeefyVaultFactoring) {
                        console.log('finalPrice', finalPrice);
                        console.log('this.BeefyVaultFactoring', this.BeefyVaultFactoring)
                        finalPrice = finalPrice * this.BeefyVaultFactoring;
                    }
                    console.log("final price", finalPrice);
                    if(tokenAddress === "0x321162Cd933E2Be498Cd2267a90534A804051b11"){
                        this.price = toBN((finalPrice * 10000).toFixed()).mul(decimalsFactor).div(toBN(10000));
                    console.log('logged price', this.price.toNumber())
                    return
                        }
                    this.price = toBN((finalPrice * 10000).toFixed()).mul(priceFeedDecimalsFactor).div(toBN(10000));


                    console.log('logged price', this.price.toNumber())
                    return
                }
                catch (err) {
                    console.log("!!!!!!");
                    console.log("FTM chain price determination reverted to oracle price");
                    err['response'] ? console.log(err['response']['data']['description']) : console.log(err);
                    console.log("!!!!!!");
                    this.price = await this.vault.methods.getEthPriceSource().call()
                    console.log('price', this.price)
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

        let oraclePrice = toBN(this.price).mul(toBN(10));
        const priceFeedDecimalsFactor = toBN(10).pow(toBN(this.feedDecimals));
        oraclePrice = oraclePrice.div(priceFeedDecimalsFactor);
        oraclePrice = oraclePrice.toNumber() / 10;
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
        const vaultName = await this.vault.methods.name().call();
        const fileName = `subjob${this.networkName}_MAI_${vaultName}.json`;
        const day = getDay();
        if(this.sending){
        uploadJsonFile(JSON.stringify(this.output), fileName, day);
    }
        console.log(JSON.stringify(this.output))
        console.log("total bad debt", this.sumOfBadDebt.toString(), { currTime })

        const borrowsDecimals = toBN("10").pow(toBN(18));
        borrows = borrows.div(borrowsDecimals);
        this.sumOfBorrows = borrows.toNumber();

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
