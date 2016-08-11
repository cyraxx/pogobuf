'use strict';
/*
    This example script shows how to work with the getInventory() API call and the splitInventory() function.
*/
const pogobuf = require('../pogobuf/pogobuf'),
    POGOProtos = require('node-pogo-protos');

const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const googleLogin = new pogobuf.GoogleLogin(),
    client = new pogobuf.Client();

new Promise(function(resolve, reject) {
    console.log("Please visit", pogobuf.GoogleLogin.GET_AUTH_CODE_URL, "to get authentication key.")
    rl.question('Enter authentication key:', (authCode) => {
        resolve(authCode)
        rl.close();
    });
})
.then(function(authCode) {
    return googleLogin.loginWithAuthCode(authCode);
})
.then(token => {
    console.log(token)
    // Initialize the client
    client.setAuthInfo('google', token);

    // Uncomment the following if you want to see request/response information on the console
    client.on('request', console.dir);
    client.on('response', console.dir);

    // Perform the initial request
    return client.init();
})
.then(() => {
    // Get full inventory
    return client.getInventory(0);
})
.then(inventory => {
    if (!inventory.success) throw Error('success=false in inventory response');

    // Split inventory into individual arrays and log them on the console
    inventory = pogobuf.Utils.splitInventory(inventory);
    console.log('Full inventory:', inventory);

    console.log('Items:');
    inventory.items.forEach(item => {
        console.log(item.count + 'x ' + pogobuf.Utils.getEnumKeyByValue(POGOProtos.Inventory.Item.ItemId, item.item_id));
    });
})
.catch(console.error);