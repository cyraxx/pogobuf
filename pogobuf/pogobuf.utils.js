/**
 * Various utilities for dealing with Pokémon Go API requests.
 * @class Utils
 * @memberof pogobuf
 */

module.exports = {
    /**
     * Takes a getInventory() response and separates it into pokemon, items, candies, player data, eggs, and pokedex.
     * @param {object} inventory - API response message as returned by getInventory()
     * @returns {object}
     * @static
     */
    splitInventory: function(inventory) {
        if (!inventory || !inventory.inventory_delta || !inventory.inventory_delta.inventory_items)
            return {};

        var pokemon = [],
            items = [],
            pokedex = [],
            player = null,
            currency = [],
            camera = null,
            inventory_upgrades = [],
            applied_items = [],
            egg_incubators = [],
            candies = [];

        inventory.inventory_delta.inventory_items.forEach(item => {
            var itemdata = item.inventory_item_data;
            if (itemdata.pokemon_data) {
                pokemon.push(itemdata.pokemon_data);
            }
            if (itemdata.item) {
                items.push(itemdata.item);
            }
            if (itemdata.pokedex_entry) {
                pokedex.push(itemdata.pokedex_entry);
            }
            if (itemdata.player_stats) {
                player = itemdata.player_stats;
            }
            if (itemdata.player_currency) {
                currency.push(itemdata.player_currency);
            }
            if (itemdata.player_camera) {
                camera = itemdata.player_camera;
            }
            if (itemdata.inventory_upgrades) {
                inventory_upgrades.push(itemdata.inventory_upgrades);
            }
            if (itemdata.applied_items) {
                applied_items.push(itemdata.applied_items);
            }
            if (itemdata.egg_incubators) {
                egg_incubators.push(itemdata.egg_incubators);
            }
            if (itemdata.pokemon_family) {
                candies.push(itemdata.pokemon_family);
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
        };
    },

    /**
     * Utility method that finds the name of the key for a given enum value and makes it
     * look a little nicer.
     * @param {object} enumObj
     * @param {number} val
     * @returns {string}
     * @static
     */
    getEnumKeyByValue: function(enumObj, val) {
        for (var key of Object.keys(enumObj)) {
            if (enumObj[key] === val)
                return key.charAt(0).toUpperCase() + key.slice(1).toLowerCase();
        }
        return null;
    }
};