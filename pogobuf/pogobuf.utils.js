module.exports = {
  /**
   * Takes whole inventory, and seperates them into pokemon, items, candies, player data , eggs and pokedex
   * @public
   * @param {array} inventory
   * @returns {object}
   */
  parseInventory  : function(inventory) {
    var pokemon = [];
    var items = [];
    var pokedex = [];
    var player = null;
    var currency = [];
    var camera = null;
    var inventory_upgrades = [];
    var applied_items = [];
    var egg_incubators = [];
    var candies = [];    
    
    var inv = inventory.inventory_delta.inventory_items;
    inv.forEach((item) => {
      var itemdata = item.inventory_item_data;
      if (itemdata.pokemon_data) {
        pokemon.push(itemdata.pokemon_data)
      }
      if (itemdata.item) {
        items.push(itemdata.item)
      }
      if (itemdata.pokedex_entry) {
        pokedex.push(itemdata.pokedex_entry)
      }
      if (itemdata.player_stats) {
        player = itemdata.player_stats;
      }
      if (itemdata.player_currency) {
        currency.push(itemdata.player_currency)
      }
      if (itemdata.player_camera) {
        camera = itemdata.player_camera;
      }
      if (itemdata.inventory_upgrades) {
        inventory_upgrades.push(itemdata.inventory_upgrades)
      }
      if (itemdata.applied_items) {
        applied_items.push(itemdata.applied_items)
      }
      if (itemdata.egg_incubators) {
        egg_incubators.push(itemdata.egg_incubators)
      }
      if (itemdata.pokemon_family) {
        candies.push(itemdata.pokemon_family)
      }
    });
    
    return {
      pokemon: pokemon,
      items: items,
      pokedex: pokedex,
      player: player,
      currency: currency,
      camera: camera,
      inventory_upgrades: inventory_upgrades,
      applied_items: applied_items,
      egg_incubators: egg_incubators,
      candies: candies
    }
  }
}