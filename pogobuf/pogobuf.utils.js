'use strict';

var s2 = require('s2-geometry').S2,
    Long = require('long');

/**
 * Various utilities for dealing with Pokémon Go API requests.
 * @class Utils
 * @memberof pogobuf
 */

module.exports = {
    /**
     * Provides cell IDs of nearby cells based on the given coords and radius
     * @param {number} lat
     * @param {number} lng
     * @param {number} [radius=3]
     * @returns {array}
     * @static
     */
    getCellIDs: function(lat, lng, radius) {
        if (typeof radius === 'undefined') radius = 3;

        /* eslint-disable new-cap */
        var origin = s2.S2Cell.FromLatLng({
            lat: lat,
            lng: lng
        }, 15);
        var cells = [];

        cells.push(origin.toHilbertQuadkey()); // middle block

        for (var i = 1; i < radius; i++) {
            // cross in middle
            cells.push(s2.S2Cell.FromFaceIJ(origin.face, [origin.ij[0], origin.ij[1] - i], origin.level)
                .toHilbertQuadkey());
            cells.push(s2.S2Cell.FromFaceIJ(origin.face, [origin.ij[0], origin.ij[1] + i], origin.level)
                .toHilbertQuadkey());
            cells.push(s2.S2Cell.FromFaceIJ(origin.face, [origin.ij[0] - i, origin.ij[1]], origin.level)
                .toHilbertQuadkey());
            cells.push(s2.S2Cell.FromFaceIJ(origin.face, [origin.ij[0] + i, origin.ij[1]], origin.level)
                .toHilbertQuadkey());

            for (var j = 1; j < radius; j++) {
                cells.push(s2.S2Cell.FromFaceIJ(origin.face, [origin.ij[0] - j, origin.ij[1] - i], origin.level)
                    .toHilbertQuadkey());
                cells.push(s2.S2Cell.FromFaceIJ(origin.face, [origin.ij[0] + j, origin.ij[1] - i], origin.level)
                    .toHilbertQuadkey());
                cells.push(s2.S2Cell.FromFaceIJ(origin.face, [origin.ij[0] - j, origin.ij[1] + i], origin.level)
                    .toHilbertQuadkey());
                cells.push(s2.S2Cell.FromFaceIJ(origin.face, [origin.ij[0] + j, origin.ij[1] + i], origin.level)
                    .toHilbertQuadkey());
            }
        }
        /* eslint-enable new-cap */

        return cells.map((cell) => {
            return s2.toId(cell);
        });
    },

    /**
     * Takes a getInventory() response and separates it into pokemon, items, candies, player data,
     * eggs, and pokedex.
     * @param {object} inventory - API response message as returned by getInventory()
     * @returns {object}
     * @static
     */
    splitInventory: function(inventory) {
        if (!inventory || !inventory.success || !inventory.inventory_delta ||
            !inventory.inventory_delta.inventory_items) {
            return {};
        }

        var ret = {
            pokemon: [],
            items: [],
            pokedex: [],
            player: null,
            currency: [],
            camera: null,
            inventory_upgrades: [],
            applied_items: [],
            egg_incubators: [],
            candies: []
        };

        inventory.inventory_delta.inventory_items.forEach(item => {
            var itemdata = item.inventory_item_data;
            if (Object.keys(itemdata.pokemon_data == null ? {} : itemdata.pokemon_data).length !== 0) {
                ret.pokemon.push(itemdata.pokemon_data);
            }
            if (Object.keys(itemdata.item == null ? {} : itemdata.item).length !== 0) {
                ret.items.push(itemdata.item);
            }
            if (Object.keys(itemdata.pokedex_entry == null ? {} : itemdata.pokedex_entry).length !== 0) {
                ret.pokedex.push(itemdata.pokedex_entry);
            }
            if (itemdata.player_stats) {
                ret.player = itemdata.player_stats;
            }
            if (Object.keys(itemdata.player_currency == null ? {} : itemdata.player_currency).length !== 0) {
                ret.currency.push(itemdata.player_currency);
            }
            if (itemdata.player_camera) {
                ret.camera = itemdata.player_camera;
            }
            if (Object.keys(itemdata.inventory_upgrades == null ? {} : itemdata.inventory_upgrades).length !== 0) {
                ret.inventory_upgrades.push(itemdata.inventory_upgrades);
            }
            if (Object.keys(itemdata.applied_items == null ? {} : itemdata.applied_items).length !== 0) {
                ret.applied_items.push(itemdata.applied_items);
            }
            if (Object.keys(itemdata.egg_incubators == null ? {} : itemdata.egg_incubators).length !== 0) {
                ret.egg_incubators.push(itemdata.egg_incubators);
            }
            if (Object.keys(itemdata.candy == null ? {} : itemdata.candy).length !== 0) {
                ret.candies.push(itemdata.candy);
            }
        });

        return ret;
    },

    /**
     * Takes a downloadItemTemplates() response and separates it into the individual
     * settings objects.
     * @param {object} templates - API response message as returned by downloadItemTemplates()
     * @returns {object}
     * @static
     */
    splitItemTemplates: function(templates) {
        if (!templates || !templates.success || !templates.item_templates) return {};

        var ret = {
            pokemon_settings: [],
            item_settings: [],
            move_settings: [],
            move_sequence_settings: [],
            type_effective_settings: [],
            badge_settings: [],
            camera_settings: null,
            player_level_settings: null,
            gym_level_settings: null,
            battle_settings: null,
            encounter_settings: null,
            iap_item_display: [],
            iap_settings: null,
            pokemon_upgrade_settings: null,
            equipped_badge_settings: null
        };

        templates.item_templates.forEach(template => {
            if (Object.keys(template.pokemon_settings == null ? {} : template.pokemon_settings).length !== 0) {
                ret.pokemon_settings.push(template.pokemon_settings);
            }
            if (Object.keys(template.item_settings == null ? {} : template.item_settings).length !== 0) {
                ret.item_settings.push(template.item_settings);
            }
            if (Object.keys(template.move_settings == null ? {} : template.move_settings).length !== 0) {
                ret.move_settings.push(template.move_settings);
            }
            if (Object.keys(template.move_sequence_settings == null ? {} : template.move_sequence_settings).length !== 0) {
                ret.move_sequence_settings.push(template.move_sequence_settings.sequence);
            }
            if (Object.keys(template.type_effective == null ? {} : template.type_effective).length !== 0) {
                ret.type_effective_settings.push(template.type_effective);
            }
            if (Object.keys(template.badge_settings == null ? {} : template.badge_settings).length !== 0) {
                ret.badge_settings.push(template.badge_settings);
            }
            if (template.camera) {
                ret.camera_settings = template.camera;
            }
            if (template.player_level) {
                ret.player_level_settings = template.player_level;
            }
            if (template.gym_level) {
                ret.gym_level_settings = template.gym_level;
            }
            if (template.battle_settings) {
                ret.battle_settings = template.battle_settings;
            }
            if (template.encounter_settings) {
                ret.encounter_settings = template.encounter_settings;
            }
            if (Object.keys(template.iap_item_display == null ? {} : template.iap_item_display).length !== 0) {
                ret.iap_item_display.push(template.iap_item_display);
            }
            if (template.iap_settings) {
                ret.iap_settings = template.iap_settings;
            }
            if (template.pokemon_upgrades) {
                ret.pokemon_upgrade_settings = template.pokemon_upgrades;
            }
            if (template.equipped_badges) {
                ret.equipped_badge_settings = template.equipped_badges;
            }
        });

        return ret;
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
            if (enumObj[key] === val) {
                return key.split('_')
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                    .join(' ');
            }
        }
        return null;
    },

    /**
     * Utility method to get the Individual Values from Pokémon
     * @param {object} pokemon - A pokemon_data structure
     * @param {integer} [decimals=-1] - Amount of decimals, negative values do not round, max 20
     * @returns {object}
     * @static
     */
    getIVsFromPokemon: function(pokemon, decimals) {
        if(typeof decimals === 'undefined') decimals = -1;

        decimals = Math.min(decimals, 20);

        var att = pokemon.individual_attack;
        var def = pokemon.individual_defense;
        var stam = pokemon.individual_stamina;

        var unrounded_percent = (att + def + stam) / 45 * 100;
        var percent = decimals < 0 ? unrounded_percent : +unrounded_percent.toFixed(decimals);

        return {
            att: att,
            def: def,
            stam: stam,
            percent: percent
        };
    },

    /**
     * Utility method to convert all Long.js objects to integers or strings
     * @param {object} object – An object
     * @returns {object}
     * @static
     */
    convertLongs: function(object) {
        if(!object || typeof object !== 'object') return new Object();

        if(Long.isLong(object)) return object.lessThanOrEqual(Number.MAX_SAFE_INTEGER) && object.greaterThanOrEqual(Number.MIN_SAFE_INTEGER) ? object.toNumber() : object.toString();

        for(var i in object) {
            if(object.hasOwnProperty(i)) {
                if(Long.isLong(object[i]))
                    object[i] = object[i].lessThanOrEqual(Number.MAX_SAFE_INTEGER) && object[i].greaterThanOrEqual(Number.MIN_SAFE_INTEGER) ? object[i].toNumber() : object[i].toString();
                else if(typeof object[i] === 'object')
                    object[i] = this.convertLongs(object[i]);
            }
        }

        return object;
    }
};
