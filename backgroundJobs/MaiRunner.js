const Web3 = require('web3');
const MaiParser = require('./MaiParser')
const axios = require('axios')
const { toBN } = Web3.utils


const sleep = ms => new Promise(r => setTimeout(r, ms));


async function maiRunner(onlyFTM = false, sending = true) {
    const mai = [
        {
            "name": "polygon",
            "web3": "https://polygon-rpc.com",
            "network": "MATIC",
            "addresses": [
                "0xa3fa99a148fa48d14ed51d610c367c61876997f1",
                "0x3fd939B017b31eaADF9ae50C7fF7Fa5c0661d47C",
                "0x61167073E31b1DAd85a3E531211c7B8F1E5cAE72",
                "0x87ee36f780ae843A78D5735867bc1c13792b7b11",
                "0x98B5F32dd9670191568b661a3e847Ed764943875",
                "0x701A1824e5574B0b6b1c8dA808B184a7AB7A2867",
                "0x649Aa6E6b6194250C077DF4fB37c23EE6c098513",
                "0x37131aEDd3da288467B6EBe9A77C523A700E6Ca1",
                "0xF086dEdf6a89e7B16145b03a6CB0C0a9979F1433",
                "0x88d84a85A87ED12B8f098e8953B322fF789fCD1a",
                "0x11A33631a5B5349AF3F165d2B7901A4d67e561ad",
                "0x578375c3af7d61586c2C3A7BA87d2eEd640EFA40",
                "0x7dda5e1a389e0c1892caf55940f5fce6588a9ae0",
                "0xD2FE44055b5C874feE029119f70336447c8e8827",
                "0x57cbf36788113237d64e46f25a88855c3dff1691",
                "0xff2c44fb819757225a176e825255a01b3b8bb051",
                "0x7CbF49E4214C7200AF986bc4aACF7bc79dd9C19a",
                "0x506533B9C16eE2472A6BF37cc320aE45a0a24F11",
                "0x7d36999a69f2b99bf3fb98866cbbe47af43696c8",
                "0x1f0aa72b980d65518e88841ba1da075bd43fa933",
                "0x178f1c95c85fe7221c7a6a3d6f12b7da3253eeae",
                "0x305f113ff78255d4f8524c8f50c7300b91b10f6a",
                "0x1dcc1f864a4bd0b8f4ad33594b758b68e9fa872c",
                "0xaa19d0e397c964a35e6e80262c692dbfc9c23451",
                "0x11826d20b6a16a22450978642404da95b4640123",
                "0xa3b0A659f2147D77A443f70D96b3cC95E7A26390",
                "0x7d75F83f0aBe2Ece0b9Daf41CCeDdF38Cb66146b",
                "0x9A05b116b56304F5f4B3F1D5DA4641bFfFfae6Ab",
                "0xF1104493eC315aF2cb52f0c19605443334928D38",
                "0x3bcbAC61456c9C9582132D1493A00E318EA9C122",
                "0xb1f28350539b06d5a35d016908eef0424bd13c4b"
            ]
        },
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
        {
            "name": "avalanche",
            "web3": "https://rpc.ankr.com/avalanche",
            "network": "AVAX",
            "addresses": [
                "0xfA19c1d104F4AEfb8d5564f02B3AdCa1b515da58",
                "0x13a7fe3ab741ea6301db8b164290be711f546a73",
                "0xa9122dacf3fccf1aae6b8ddd1f75b6267e5cbbb8",
                "0x1f8f7a1d38e41eaf0ed916def29bdd13f2a3f11a",
                "0x73a755378788a4542a780002a75a7bae7f558730"
            ]
        },
        {
            "name": "arbitrum",
            "web3": "https://arb1.arbitrum.io/rpc",
            "network": "ARBITRUM",
            "addresses": [
                "0xC76a3cBefE490Ae4450B2fCC2c38666aA99f7aa0",
                "0xB237f4264938f0903F5EC120BB1Aa4beE3562FfF",
                "0xd371281896f2F5f7A2C65F49d23A2B6ecfd594f3",
                "0xe47ca047Cb7E6A9AdE9405Ca68077d63424F34eC",
                "0xa864956ff961ce62c266a8563b46577d3573372e",
                "0x950eceee9e7d7366a24fc9d2ed4c0c37d17a0fa9",
                "0xe47ca047Cb7E6A9AdE9405Ca68077d63424F34eC"
            ]
        },
        {
            "name": "moonriver",
            "web3": "https://moonriver.public.blastapi.io",
            "network": "MOONRIVER",
            "addresses": [
                "0x4a0474E3262d4DB3306Cea4F207B5d66eC8E0AA9",
                "0x97D811A7eb99Ef4Cb027ad59800cE27E68Ee1109",
                "0x5db6617ddf077d76cfd9d7fc0fa91aaabc3da683",
            ]
        },
        {
            "name": "harmony",
            "web3": "https://api.harmony.one",
            "network": "HARMONY",
            "addresses": [
                "0x46469f995A5CB60708200C25EaD3cF1667Ed36d6",
                "0x12FcB286D664F37981a42cbAce92eAf28d1dA94f",
                "0x9f4E3d01c634441F284beb92bBAEeb76133BbB28",
            ]
        },
        {
            "name": "gnosis",
            "web3": "https://rpc.gnosis.gateway.fm",
            "network": "GNOSIS",
            "addresses": [
                "0x5c49b268c9841AFF1Cc3B0a418ff5c3442eE3F3b",
                "0x014a177e9642d1b4e970418f894985dc1b85657f",
            ]
        },
        {
            "name": "optimism",
            "web3": "https://opt-mainnet.g.alchemy.com/v2/AQQpXTmPUne9UvG61Z7Otnp_aWSsASwV",
            "network": "OPTIMISM",
            "addresses": [
                "0x062016cd29fabb26c52bab646878987fc9b0bc55",
                "0xb9c8f0d3254007ee4b98970b94544e473cd610ec",
                "0xbf1aea8670d2528e08334083616dd9c5f3b087ae",
                "0xAB91c51b55F7Dd7B34F2FD7217506fD5b632B2B9",
                "0xF9CE2522027bD40D3b1aEe4abe969831FE3BeAf5",
                "0xB89c1b3d9f335B9d8Bb16016F3d60160AE71041f",
                "0x86f78d3cbca0636817ad9e27a44996c738ec4932",
                "0xa478e708a27853848c6bc979668fe6225fee46fa",
                "0x7198ff382b5798dab7dc72a23c1fec9dc091893b",
                "0xc88c8ada95d92c149377aa660837460775dcc6d9"
            ]
        },
        {
            "name": "BSC",
            "web3": "https://bsc-dataseed1.binance.org/",
            "network": "BSC",
            "addresses": [
                "0xa56f9a54880afbc30cf29bb66d2d9adcdcaeadd6",
                "0x014a177e9642d1b4e970418f894985dc1b85657f",
                "0x7333fd58d8D73a8e5FC1a16C8037ADa4f580FA2B",
            ]
        },
        {
            "name": "metis",
            "web3": "https://andromeda.metis.io/?owner=1088",
            "network": "METIS",
            "addresses": [
                "0x10dcbee8afa39a847707e16aea5eb34c6b01aba9",
                "0xc09c73f7b32573d178138e76c0e286ba21085c20",
                "0xb89c1b3d9f335b9d8bb16016f3d60160ae71041f",
                "0x5A03716bd1f338D7849f5c9581AD5015ce0020B0",
                "0x19Cb63CCbfAC2f28B1fd79923f6aDfC096e6EBB4"
            ]
        },
        {
            "name": "ethereum",
            "web3": "https://eth-mainnet.g.alchemy.com/v2/8n_vZdyeQruIzqHrzgNwVaVTf_1xSUJc",
            "network": "ETH",
            "addresses": [
                "0x60d133c666919B54a3254E0d3F14332cB783B733",
                "0xEcbd32bD581e241739be1763DFE7a8fFcC844ae1",
                "0x98eb27E5F24FB83b7D129D789665b08C258b4cCF",
                "0x8C45969aD19D297c9B85763e90D0344C6E2ac9d1",
                "0xcc61Ee649A95F2E2f0830838681f839BDb7CB823",
                "0x82E90EB7034C1DF646bD06aFb9E67281AAb5ed28",
                "0x67411793c5dcf9abc5a8d113ddd0e596cd5ba3e7",
                "0xD1a6F422ceFf5a39b764e340Fd1bCd46C0744F83",
                "0x86f78d3cbCa0636817AD9e27a44996C738Ec4932",
                "0xCA3EB45FB186Ed4e75B9B22A514fF1d4abAdD123",
                "0x4ce4c542d96ce1872fea4fa3fbb2e7ae31862bad",
                "0x5773e8953cf60f495eb3c2db45dd753b5c4b7473",
                "0x954ac12c339c60eafbb32213b15af3f7c7a0dec2",
            ]
        },
    ]

    let badDebt = {
        "total": 0,
    };
    let totalBorrows = 0;


    for (const network of mai) {
        console.log('sending ?', sending);
        console.log("network", network.name);
        badDebt[network] = {};
        const web3 = new Web3(network["web3"]);
        for (const addr of network["addresses"]) {
            console.log("vault address", addr);
            if (network.name === "FTM") {
                sleepTime = 15000;
                //// Get FTM value
                let geckoFTMPrice = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=fantom&vs_currencies=usd`);
                geckoFTMPrice = geckoFTMPrice.data['fantom']['usd'];

                const callInfo = {
                    "multicallSize": 1000,
                    "address": addr,
                }
                const call = new MaiParser(sending, callInfo, "FTM", "FTM", web3, geckoFTMPrice);
                const returned = await call.main(true);
                const vaultBadDebt = returned.sumOfBadDebt;
                totalBorrows += returned;
                console.log('total borrows', totalBorrows);
                badDebt[network][addr] = vaultBadDebt;
                badDebt["total"] += vaultBadDebt;
                console.log(`sleeping for ${sleepTime / 1000} seconds.`)
                await sleep(sleepTime);
            }
            if (onlyFTM === false && network !== "FTM") {
                console.log(addr)
                const callInfo = {
                    "multicallSize": 1000,
                    "address": addr,
                }

                const call = new MaiParser(sending, callInfo, network['network'], network['name'], web3);
                const returned = await call.main(true);
                totalBorrows += returned;
                const vaultBadDebt = returned.sumOfBadDebt;
                console.log('total borrows', totalBorrows);
                badDebt[network][addr] = vaultBadDebt;
                badDebt["total"] += vaultBadDebt;
            }
            if (onlyFTM === true && network !== "FTM") {
                console.log('skipping, FTM only run');
            }
        }
    }

    console.log("ending");
    console.log(badDebt);
    console.log('total borrows', totalBorrows);

}





maiRunner(false, true);