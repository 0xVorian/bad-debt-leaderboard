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
    constructor(maiInfo, network, web3, geckoFTMPrice, heavyUpdateInterval = 24) {
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

        this.output = {}
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
            return Number(fromWei(this.sumOfBadDebt.toString()))
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
                        this.feedDecimals = 18;
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
        const vaultName = await this.vault.methods.symbol().call();
        const fileName = `subjob${this.network}_MAI_${vaultName}.json`;
        const day = getDay();
        uploadJsonFile(JSON.stringify(this.output), fileName, day);
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



    const mai = [
        // {
        //     "name": "polygon",
        //     "web3": "https://polygon-rpc.com",
        //     "network": "MATIC",
        //     "addresses": [
        //         "0xa3fa99a148fa48d14ed51d610c367c61876997f1",
        //         "0x3fd939B017b31eaADF9ae50C7fF7Fa5c0661d47C",
        //         "0x61167073E31b1DAd85a3E531211c7B8F1E5cAE72",
        //         "0x87ee36f780ae843A78D5735867bc1c13792b7b11",
        //         "0x98B5F32dd9670191568b661a3e847Ed764943875",
        //         "0x701A1824e5574B0b6b1c8dA808B184a7AB7A2867",
        //         "0x649Aa6E6b6194250C077DF4fB37c23EE6c098513",
        //         "0x37131aEDd3da288467B6EBe9A77C523A700E6Ca1",
        //         "0xF086dEdf6a89e7B16145b03a6CB0C0a9979F1433",
        //         "0x88d84a85A87ED12B8f098e8953B322fF789fCD1a",
        //         "0x11A33631a5B5349AF3F165d2B7901A4d67e561ad",
        //         "0x578375c3af7d61586c2C3A7BA87d2eEd640EFA40",
        //         "0x7dda5e1a389e0c1892caf55940f5fce6588a9ae0",
        //         "0xD2FE44055b5C874feE029119f70336447c8e8827",
        //         "0x57cbf36788113237d64e46f25a88855c3dff1691",
        //         "0xff2c44fb819757225a176e825255a01b3b8bb051",
        //         "0x7CbF49E4214C7200AF986bc4aACF7bc79dd9C19a",
        //         "0x506533B9C16eE2472A6BF37cc320aE45a0a24F11",
        //         "0x7d36999a69f2b99bf3fb98866cbbe47af43696c8",
        //         "0x1f0aa72b980d65518e88841ba1da075bd43fa933",
        //         "0x178f1c95c85fe7221c7a6a3d6f12b7da3253eeae",
        //         "0x305f113ff78255d4f8524c8f50c7300b91b10f6a",
        //         "0x1dcc1f864a4bd0b8f4ad33594b758b68e9fa872c",
        //         "0xaa19d0e397c964a35e6e80262c692dbfc9c23451",
        //         "0x11826d20b6a16a22450978642404da95b4640123",
        //         "0xa3b0A659f2147D77A443f70D96b3cC95E7A26390",
        //         "0x7d75F83f0aBe2Ece0b9Daf41CCeDdF38Cb66146b",
        //         "0x9A05b116b56304F5f4B3F1D5DA4641bFfFfae6Ab",
        //         "0xF1104493eC315aF2cb52f0c19605443334928D38",
        //         "0x3bcbAC61456c9C9582132D1493A00E318EA9C122",
        //         "0xb1f28350539b06d5a35d016908eef0424bd13c4b"
        //     ]
        // },
        {
            "name": "FTM",
            "web3": "https://rpc.ftm.tools",
            "network": "FTM",
            "addresses": [
                "0x1066b8FC999c1eE94241344818486D5f944331A0",
                "0xD939c268C49c442F037E968F045ba02f499562D4",
                "0x7efB260662a6FA95c1CE1092c53Ca23733202798",
                "0x682E473FcA490B0adFA7EfE94083C1E63f28F034",
                "0x7aE52477783c4E3e5c1476Bbb29A8D029c920676",
                "0x571F42886C31f9b769ad243e81D06D0D144BE7B4",
                "0x6d6029557a06961aCC5F81e1ffF5A474C54e32Fd",
                "0xE5996a2cB60eA57F03bf332b5ADC517035d8d094",
                "0xd6488d586E8Fcd53220e4804D767F19F5C846086",
                "0x267bDD1C19C932CE03c7A62BBe5b95375F9160A6",
                "0xdB09908b82499CAdb9E6108444D5042f81569bD9",
                "0x3609A304c6A41d87E895b9c1fd18c02ba989Ba90",
                "0xC1c7eF18ABC94013F6c58C6CdF9e829A48075b4e",
                "0x5563Cc1ee23c4b17C861418cFF16641D46E12436",
                "0x8e5e4D08485673770Ab372c05f95081BE0636Fa2",
                "0xBf0ff8ac03f3E0DD7d8faA9b571ebA999a854146",
                "0xf34e271312e41bbd7c451b76af2af8339d6f16ed",
                "0x9ba01b1279b1f7152b42aca69faf756029a9abde",
                "0x75d4ab6843593c111eeb02ff07055009c836a1ef",
                "0x3f6cf10e85e9c0630856599FAB8D8BFcd9C0E7D4"
            ]
        },
        // {
        //     "name": "ethereum",
        //     "web3": "https://eth-mainnet.g.alchemy.com/v2/8n_vZdyeQruIzqHrzgNwVaVTf_1xSUJc",
        //     "network": "ETH",
        //     "addresses": [
        //         "0x60d133c666919B54a3254E0d3F14332cB783B733",
        //         "0xEcbd32bD581e241739be1763DFE7a8fFcC844ae1",
        //         "0x98eb27E5F24FB83b7D129D789665b08C258b4cCF",
        //         "0x8C45969aD19D297c9B85763e90D0344C6E2ac9d1",
        //         "0xcc61Ee649A95F2E2f0830838681f839BDb7CB823",
        //         "0x82E90EB7034C1DF646bD06aFb9E67281AAb5ed28",
        //         "0x67411793c5dcf9abc5a8d113ddd0e596cd5ba3e7",
        //         "0xD1a6F422ceFf5a39b764e340Fd1bCd46C0744F83",
        //         "0x86f78d3cbCa0636817AD9e27a44996C738Ec4932",
        //         "0xCA3EB45FB186Ed4e75B9B22A514fF1d4abAdD123",
        //         "0x4ce4c542d96ce1872fea4fa3fbb2e7ae31862bad",
        //         "0x5773e8953cf60f495eb3c2db45dd753b5c4b7473",
        //         "0x954ac12c339c60eafbb32213b15af3f7c7a0dec2",
        //     ]
        // },
        // {
        //     "name": "arbitrum",
        //     "web3": "https://arb1.arbitrum.io/rpc",
        //     "network": "ARBITRUM",
        //     "addresses": [
        //         "0xC76a3cBefE490Ae4450B2fCC2c38666aA99f7aa0",
        //         "0xB237f4264938f0903F5EC120BB1Aa4beE3562FfF",
        //         "0xd371281896f2F5f7A2C65F49d23A2B6ecfd594f3",
        //         "0xe47ca047Cb7E6A9AdE9405Ca68077d63424F34eC",
        //         "0xa864956ff961ce62c266a8563b46577d3573372e",
        //         "0x950eceee9e7d7366a24fc9d2ed4c0c37d17a0fa9",
        //         "0xe47ca047Cb7E6A9AdE9405Ca68077d63424F34eC"
        //     ]
        // },
        // {
        //     "name": "gnosis",
        //     "web3": "https://rpc.gnosis.gateway.fm",
        //     "network": "GNOSIS",
        //     "addresses": [
        //         "0x5c49b268c9841AFF1Cc3B0a418ff5c3442eE3F3b",
        //         "0x014a177e9642d1b4e970418f894985dc1b85657f",
        //     ]
        // },
        // {
        //     "name": "optimism",
        //     "web3": "https://opt-mainnet.g.alchemy.com/v2/AQQpXTmPUne9UvG61Z7Otnp_aWSsASwV",
        //     "network": "OPTIMISM",
        //     "addresses": [
        //         "0x062016cd29fabb26c52bab646878987fc9b0bc55",
        //         "0xb9c8f0d3254007ee4b98970b94544e473cd610ec",
        //         "0xbf1aea8670d2528e08334083616dd9c5f3b087ae",
        //         "0xAB91c51b55F7Dd7B34F2FD7217506fD5b632B2B9",
        //         "0xF9CE2522027bD40D3b1aEe4abe969831FE3BeAf5",
        //         "0xB89c1b3d9f335B9d8Bb16016F3d60160AE71041f",
        //         "0x86f78d3cbca0636817ad9e27a44996c738ec4932",
        //         "0xa478e708a27853848c6bc979668fe6225fee46fa",
        //         "0x7198ff382b5798dab7dc72a23c1fec9dc091893b",
        //         "0xc88c8ada95d92c149377aa660837460775dcc6d9",
        //     ]
        // },
        // {
        //     "name": "avalanche",
        //     "web3": "https://rpc.ankr.com/avalanche",
        //     "network": "AVAX",
        //     "addresses": [
        //         "0xfA19c1d104F4AEfb8d5564f02B3AdCa1b515da58",
        //         "0x13a7fe3ab741ea6301db8b164290be711f546a73",
        //         "0xa9122dacf3fccf1aae6b8ddd1f75b6267e5cbbb8",
        //         "0x1f8f7a1d38e41eaf0ed916def29bdd13f2a3f11a",
        //         "0x73a755378788a4542a780002a75a7bae7f558730",
        //     ]
        // },
        // {
        //     "name": "binance",
        //     "web3": "https://bsc-dataseed1.binance.org/",
        //     "network": "BSC",
        //     "addresses": [
        //         "0xa56f9a54880afbc30cf29bb66d2d9adcdcaeadd6",
        //         "0x014a177e9642d1b4e970418f894985dc1b85657f",
        //         "0x7333fd58d8D73a8e5FC1a16C8037ADa4f580FA2B",
        //     ]
        // },
        // {
        //     "name": "moonriver",
        //     "web3": "https://moonriver.public.blastapi.io",
        //     "network": "MOONRIVER",
        //     "addresses": [
        //         "0x4a0474E3262d4DB3306Cea4F207B5d66eC8E0AA9",
        //         "0x97D811A7eb99Ef4Cb027ad59800cE27E68Ee1109",
        //         "0x5db6617ddf077d76cfd9d7fc0fa91aaabc3da683",
        //     ]
        // },
        // {
        //     "name": "metis",
        //     "web3": "https://andromeda.metis.io/?owner=1088",
        //     "network": "METIS",
        //     "addresses": [
        //         "0x10dcbee8afa39a847707e16aea5eb34c6b01aba9",
        //         "0xc09c73f7b32573d178138e76c0e286ba21085c20",
        //         "0xb89c1b3d9f335b9d8bb16016f3d60160ae71041f",
        //         "0x5A03716bd1f338D7849f5c9581AD5015ce0020B0",
        //         "0x19Cb63CCbfAC2f28B1fd79923f6aDfC096e6EBB4",
        //     ]
        // },
        // {
        //     "name": "harmony",
        //     "web3": "https://api.harmony.one",
        //     "network": "HARMONY",
        //     "addresses": [
        //         "0x46469f995A5CB60708200C25EaD3cF1667Ed36d6",
        //         "0x12FcB286D664F37981a42cbAce92eAf28d1dA94f",
        //         "0x9f4E3d01c634441F284beb92bBAEeb76133BbB28",
        //     ]
        // },

    ]

    let badDebt = {
        "total": 0,
    };


    for(const network of mai){
        console.log(network.name)
        badDebt[network] = {};
        const web3 = new Web3(network["web3"]);
        for(const addr of network["addresses"]){
            if(network.name === "FTM"){
                    //// Get FTM value
    let geckoFTMPrice = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=fantom&vs_currencies=usd`);
    geckoFTMPrice = geckoFTMPrice.data['fantom']['usd'];

    const callInfo = {
        "multicallSize": 1000,
        "address": addr,
    }
    const call = new MaiParser(callInfo, "FTM", web3, geckoFTMPrice)
    const vaultBadDebt = await call.main(true);
    badDebt[network][addr] = vaultBadDebt;
    badDebt["total"] += vaultBadDebt;
            }
            console.log(addr)
            const callInfo = {
                "multicallSize": 1000,
                "address": addr,
            }

            const call = new MaiParser(callInfo, network["network"], web3);
            const vaultBadDebt = await call.main(true);
            badDebt[network][addr] = vaultBadDebt;
            badDebt["total"] += vaultBadDebt;
        }
    }

    console.log("ending");
    console.log(badDebt);

}

test()
