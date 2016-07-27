const pogobuf = require('./pogobuf/pogobuf');

const login = pogobuf.GoogleLogin();
const client = pogobuf.Client();

login.login('example@gmail.com', 'password')
.then(token => {
  client.setAuthInfo('google', token);
  client.setPosition(55.9803, 22.25787);
  return client.init();
})
.then(() => {
  return client.getInventory(0);
})
.then(inventory => {
  inventory = pogobuf.Utils.parseInventory(inventory);
  console.log('Items', inventory.items);
  console.log('Player data', inventory.player);
  console.log('Caught pokemons', inventory.pokemon);
})
.catch(console.error)