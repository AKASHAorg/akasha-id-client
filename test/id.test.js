/* eslint-env mocha */
/* global chai */

const IdClient = window.AKASHAidClient
const IdWallet = window.AKASHAidWallet

const sleep = timeout => {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve()
    }, timeout)
  })
}

describe('AKASHA ID', function () {
  const appInfo = {
    name: 'AKASHA.world',
    description: 'The super cool AKASHA World app!',
    icon: 'https://app.akasha.world/icon.png',
    url: 'https://app.akasha.world'
  }

  const config = {
    hubUrls: ['http://localhost:8888'],
    walletUrl: 'http://localhost:3000'
  }
  const profileName = 'jane'
  const profilePass = 'password'

  let Client
  const Wallet = new IdWallet(config)

  context('Init Client', () => {
    it('Should fail to instantiate Client without appInfo', () => {
      let err
      try {
        Client = new IdClient(undefined, {})
      } catch (error) {
        err = error
      }
      chai.assert.equal(err.message, 'Missing app details')
    })

    it('Should fail to instantiate Client without config', () => {
      let err
      try {
        Client = new IdClient(appInfo, undefined)
      } catch (error) {
        err = error
      }
      chai.assert.equal(err.message, 'Missing config details')

      try {
        Client = new IdClient(appInfo, {})
      } catch (error) {
        err = error
      }
      chai.assert.equal(err.message, 'Missing config details')

      try {
        Client = new IdClient(appInfo, { hubUrls: 'http://localhost:8888' })
      } catch (error) {
        err = error
      }
      chai.assert.equal(err.message, 'Missing config details')

      try {
        Client = new IdClient(appInfo, { walletUrl: 'http://localhost:8888' })
      } catch (error) {
        err = error
      }
      chai.assert.equal(err.message, 'Missing config details')
    })

    it('Should successfully instantiate Client with proper parameters', () => {
      let err
      try {
        Client = new IdClient(appInfo, config)
      } catch (error) {
        err = error
      }
      chai.assert.isUndefined(err)
    })
  })

  context('Client API', () => {
    it('Should successfully generate registration links', async () => {
      const link = await Client.registrationLink()
      const walletStr = link.substring(0, config.walletUrl.length)
      const reqStr = link.substring(config.walletUrl.length)

      chai.assert.equal(walletStr, config.walletUrl)
      chai.assert.equal(reqStr.length, 96)
    })
  })

  context('Client <-> Wallet e2e', () => {
    // first we create a valid profile
    before(async () => {
      await Wallet.init()
      await Wallet.signup(profileName, profilePass)
      const profile = {
        name: 'foo bar',
        familyName: 'bar',
        givenName: 'foo',
        email: 'foo@bar.org'
      }
      await Wallet.updateProfile(profile)
      await sleep(300)
    })

    let clientClaim

    it('Should fail to register a new app from a request that was denied', async () => {
      const link = await Client.registrationLink()

      const request = Client.requestProfile()
      // give the client some time to setup listener
      await sleep(100)

      const msg = await Wallet.registerApp(link.substring(config.walletUrl.length))
      chai.assert.isUndefined(msg.attributes)
      await Wallet.sendClaim(msg, [], false)

      const apps = await Wallet.apps()
      chai.assert.isEmpty(apps)

      return new Promise(resolve => {
        request.then(response => {
          chai.assert.isFalse(response.allowed)
          chai.assert.isUndefined(response.claim)
          return resolve()
        })
      })
    })

    it('Should successfully register a new app from a request that was allowed', async () => {
      const attributes = ['name', 'email']

      const link = await Client.registrationLink()

      const request = Client.requestProfile(attributes)
      // give the client some time to setup listener
      await sleep(100)

      const msg = await Wallet.registerApp(link.substring(config.walletUrl.length))
      chai.assert.exists(msg.token)
      chai.assert.exists(msg.key)
      chai.assert.exists(msg.channel)
      chai.assert.equal(msg.nonce, Client.nonce)
      chai.assert.deepEqual(msg.appInfo, appInfo)
      chai.assert.deepEqual(msg.attributes, attributes)

      // save app
      await Wallet.addApp(msg.token, msg.appInfo)
      await Wallet.sendClaim(msg, attributes, true)

      const apps = await Wallet.apps()
      chai.assert.deepEqual(apps[msg.token], appInfo)

      const profile = await Wallet.profile()

      return new Promise(resolve => {
        request.then(response => {
          chai.assert.isTrue(response.allowed)
          chai.assert.equal(response.did, Wallet.currentDID())
          chai.assert.equal(response.token, msg.token)
          chai.assert.isDefined(response.claim)
          // check if we have all the attributes and values
          attributes.forEach(attr => {
            chai.assert.equal(profile[attr], response.claim.credentialSubject[attr])
          })
          // save this client claim for refresh test
          clientClaim = response
          return resolve()
        })
      })
    })

    it('Should successfully refresh a claim', async () => {
      const request = Client.refreshProfile(clientClaim)

      // give the wallet some time to process the request
      await sleep(200)

      const claim = await Wallet.getClaim(clientClaim.token)

      return new Promise(resolve => {
        request.then(async response => {
          chai.assert.isTrue(response.allowed)
          chai.assert.equal(response.did, Wallet.currentDID())
          chai.assert.equal(response.token, clientClaim.token)
          chai.assert.notEqual(response.refreshEncKey, clientClaim.refreshEncKey)
          chai.assert.equal(response.refreshEncKey, claim.key)
          resolve()
        }).then(err => {
          console.log(err)
          resolve()
        })
      })
    })
  })
})
