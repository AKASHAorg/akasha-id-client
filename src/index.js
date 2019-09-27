const Signalhub = require('signalhub') // might switch to SocketCluster later
const WebCrypto = require('easy-web-crypto')

const APP_NAME = 'AKASHA'

let DEBUGGING = false

// enable/disable debug
function debug () {
  if (DEBUGGING) {
    console.log.apply(this, arguments)
  }
}

// Initialize the signalhub connection
const initHub = (hubUrls) => {
  const hub = Signalhub(APP_NAME, hubUrls)
  // catch errors
  hub.on('error', ({ url, error }) => {
    throw new Error('Connection error', url, error)
  })
  return hub
}

class Client {
  /**
    * Class constructor
    *
    * @param {Object} appInfo - An object containing app info to be used in the
    * registration process
    * @param {Object} config - Configuration options
    */
  constructor (appInfo, config = {}) {
    if (!appInfo) {
      throw new Error('Missing app details')
    }
    this.appInfo = appInfo

    // init config
    if (!config || !config.hubUrls || !config.walletUrl) {
      throw new Error('Missing config details')
    }
    this.config = config
    this.config.timeout = this.config.timeout || 5000 // 5 seconds
    this.loginHub = undefined
    // debug
    DEBUGGING = config.debug ? config.debug : false
  }

  /**
    * Generate a special link to request access to the user's DID
    *
    * @param {Boolean} encode - Whether to encode the hashed parameters or not (in case it
    * will be part of a frag identifier)
    * @returns {string} - A formatted link containing the necessary info to register the app
    */
  async registrationLink (encode = false) {
    // cleaup previous login attemps
    this.cleanUp()
    // generate a one time channel ID
    this.loginChannel = WebCrypto.genId()
    // generate NONCE
    this.nonce = `${this.genNonce(100, 999)}-${this.genNonce(100, 999)}`
    // generate a one time symmetric encryption key and reveal it to AKASHA.id
    this.bootstrapKey = await WebCrypto.genAESKey(true, 'AES-GCM', 128)
    const extractedKey = await WebCrypto.exportKey(this.bootstrapKey)
    const b64Key = Buffer.from(extractedKey).toString('base64')

    // use the wallet app URL for the link
    const hashParams = JSON.stringify([this.loginChannel, b64Key, this.nonce])
    debug(hashParams)
    let hashed = Buffer.from(hashParams).toString('base64')
    hashed = (encode) ? encodeURIComponent(hashed) : hashed
    this.loginLink = this.config.walletUrl + hashed
    return this.loginLink
  }

  // Generate a none
  genNonce (min, max) {
    min = Math.ceil(min || 100000)
    max = Math.floor(max || 999999)
    return Math.floor(Math.random() * (max - min + 1)) + min
  }

  /**
    * Bootstrap the login process by creating a listener that also handles
    * message exchanges for app registration
    *
    * @param {Array} attributes - A list of profile attributes that are useful to the
    * client application
    * @returns {Promise<Object>} - The response from the IDP, may contain a claim if
    * the app was allowed (i.e. if msg.allowed is true)
    */
  async requestProfile (attributes) {
    if (!this.loginLink) {
      await this.registrationLink()
    }
    return new Promise((resolve, reject) => {
      try {
        this.loginHub = initHub(this.config.hubUrls)
        this.loginHub.subscribe(this.loginChannel).on('data', async (data) => {
          data = JSON.parse(data)
          if (data.request === 'reqInfo') {
            debug('Received encrypted data:', data)
            const msg = await WebCrypto.decrypt(this.bootstrapKey, data.msg, 'base64')
            debug('Decrypted data:', msg)
            if (msg.nonce && msg.nonce === this.nonce) {
              // the AKASHA.id app is requesting app details
              const encKey = await WebCrypto.importKey(Buffer.from(msg.encKey, 'base64'))
              // genereate new key
              // generate a one time symmetric encryption key and reveal it to AKASHA.id
              this.bootstrapKey = await WebCrypto.genAESKey(true, 'AES-GCM', 128)
              const exportedKey = await WebCrypto.exportKey(this.bootstrapKey)
              const b64Key = Buffer.from(exportedKey).toString('base64')
              const encryptedMsg = await WebCrypto.encrypt(encKey, {
                token: msg.token,
                nonce: msg.nonce,
                appInfo: this.appInfo,
                attributes,
                key: b64Key
              }, 'base64')
              this.loginHub.broadcast(this.loginChannel, JSON.stringify({ request: 'appInfo', msg: encryptedMsg }))
            }
          } else if (data.request === 'claim') {
            const msg = await WebCrypto.decrypt(this.bootstrapKey, data.msg, 'base64')
            debug('Got response:', msg)
            if (msg.nonce && msg.nonce === this.nonce) {
              resolve(msg)
              this.cleanUp()
            }
          }
        })
      } catch (e) {
        reject(e)
      }
    })
  }

  /**
    * Request an updated claim for the user
    *
    * @param {string} channel - The channel to be used for requests
    * @param {string} token - The application token to send
    * @param {string} rawKey - The encryption key to use for the request message
    * @returns {Promise<Object>} - The refreshed profile claim
    */
  async refreshProfile (claim) {
    if (!claim.did || !claim.token || !claim.refreshEncKey) {
      debug('refreshProfile:', claim.did, claim.token, claim.refreshEncKey)
      throw new Error('You need to provide each of channel ID, app token, and encryption key for the request.')
    }
    try {
      // get refresh channel from the user's DID by stripping 'did:akasha:'
      const channel = this.getChannelFromDID(claim.did)
      debug('Refreshing profile using:', channel, claim.token, claim.refreshEncKey)
      // prepare request
      const key = await WebCrypto.importKey(Buffer.from(claim.refreshEncKey, 'base64'))
      // encrypt message to be sent
      const nonce = this.genNonce()
      const updateChannel = WebCrypto.genId()
      const encryptedMsg = await WebCrypto.encrypt(key, {
        nonce: nonce,
        channel: updateChannel
      }, 'base64')
      // set up listener
      return new Promise((resolve, reject) => {
        const updateHub = initHub(this.config.hubUrls)
        // close hub and free connection if the timeout is reached
        window.setTimeout(() => {
          updateHub.close()
          reject(new Error('Profile refresh request timed out'))
        }, this.config.timeout)
        // request update
        try {
          updateHub.subscribe(updateChannel).on('data', async (data) => {
            data = JSON.parse(data)
            if (data.request === 'claim') {
              const msg = await WebCrypto.decrypt(key, data.msg, 'base64')
              if (msg.nonce === nonce) {
                resolve(msg)
                updateHub.close()
              }
            }
          })
          // also broadcast request
          const toSend = {
            request: 'refresh',
            token: claim.token,
            msg: encryptedMsg
          }
          debug('Sending refresh req:', toSend)
          updateHub.broadcast(channel, JSON.stringify(toSend))
        } catch (e) {
          reject(e)
          updateHub.close()
        }
      })
    } catch (e) {
      debug(e)
      throw new Error(e.message)
    }
  }

  /**
    * Return the channel ID from a DID
    *
    * @param {string} did - The user's DID
    * @returns {string} - The channel ID
    */
  getChannelFromDID (did) {
    return did.split(':')[2]
  }

  /**
    * Clean up the current registration request state
    */
  cleanUp () {
    if (this.loginHub) {
      this.loginHub.close()
      this.loginHub = null
    }
    this.loginChannel = null
    this.loginLink = null
    this.nonce = null
  }
}

module.exports = Client
