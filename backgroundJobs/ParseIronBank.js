const Addresses = require("./Addresses.js")
const Compound = require("./CompoundParser")
const Web3 = require("web3")
require('dotenv').config()

class IronBankParser extends Compound {
  constructor() {
    const compoundInfo = Addresses.ironBankAddress
    const network = 'ETH'
    const web3 = new Web3(process.env.ETH_NODE_URL)
    super(compoundInfo, network, web3, 24 * 5)
  }
}

module.exports = IronBankParser