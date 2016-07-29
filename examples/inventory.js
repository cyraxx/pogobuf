'use strict';

/*
	This example script shows how to work with the getInventory() API call and the splitInventory() function.
*/
const pogobuf = require('pogobuf'),
    POGOProtos = require('node-pogo-protos');

// Note: To avoid getting softbanned, change these coordinates to something close to where you last used your account
const lat = 37.7876146,
    lng = -122.3884353;

const login = new pogobuf.GoogleLogin(),
    client = new pogobuf.Client();

// Login to Google and get a login token
login.login('your-username@gmail.com', 'your-google-password')
    .then(token => {
        // Initialize the client
        client.setAuthInfo('google', token);
        client.setPosition(lat, lng);

        // Uncomment the following if you want to see request/response information on the console
        // client.on('request', console.dir);
        // client.on('response', console.dir);

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
