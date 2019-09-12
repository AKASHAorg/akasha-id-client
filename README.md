# akasha-id-client
[DID](https://w3c-ccg.github.io/did-spec/) client library for AKASHA.id, which should be used by applications to require access to AKASHA.id profiles.


## Install

### Via `<script>` tag

You can call `window.AKASHAidClient` in browsers by using `dist/akasha-id-client.js`.

### Via npm

`npm install --save git+https://github.com/AkashaProject/akasha-id-client`

```js
const Wallet = require('akasha-id-client')
```


## Client API

To initialize the client, you will need a list of attributes for the application you are creating, such as the application `name`, a short `description`, an app `image URL`, and finally the `app URL`. You can also pass an optional configuration parameter (as an object).

```js
const Client = require('akasha-id-client')

const config = {
    hubUrls: ['https://examplehub1.com'],
    walletUrl: 'https://akasha.id/#/wallet/',
    debug: true
}
const appInfo = {
  name: 'AKASHA.world',
  description: 'The super cool AKASHA World app!',
  icon: 'https://app.akasha.world/icon.png',
  url: 'https://app.akasha.world'
}
const client = new Client(appInfo, config)
```

**NOTE:** For convenience during development, you can start a local hub server with `npm run testhub`, which will listen on port `8080`.

The next step is to generate the initial request/login link in the app, and then display it as a button or a link for the users to click. You can also put the link in a QR code.

```js
const link = await client.registrationLink()
// -> https://akasha.id/#/wallet/WyJhIiwiMDVjZjBjNzZmMGMwZTNmNjUwODVhYTA1YmZmODFkMGI3MmI1M2VmOSIsIkVEZUJLekpwUkoyeVhUVnVncFRTQ2c9PSIsMTY4NzQ2NF0=
```

At the same time, attach an event listener for the response coming from the IDP app. The response is sent once the user has accepted or rejected the request.
You can also pass an optional parameter with a list of attributes that the client app could use to enhance the UX. This list of attributes
will help the user make an informed choice in terms of what profile data to disclose.

```js
const attributes = ['name', 'email']
const response = await client.requestProfile(attributes)
```

The response object will contain the following attributes, and it should be stored locally (client-side) for future use by the app.

```js
{
    allowed: true, // or false if the user denyed the request
    claim: { ... }, // an object containing the profile attributes shared by the user
    token: 'e6122c80e7a293901244e5cb87c32546692d5651', // unique ID for this app that is used for future requests
    refreshEncKey: '3gCE799TuL9QN5huAJ+aTg==', // one-time-use encryption key for the next request
}
```

If the app would like to request an updated version of the profile data, it can send a `refreshProfile` request.

```js
// Use the previous claim we received during the registration above
const claim = { ... }

// The token and the refreshEncKey values are taked from the previous response (above)
const response = await client.refreshProfile(claim)

console.log(response) // returns a similar response object to the one in the previous step
```
