// TODO: Create POGOProtos.d.ts typings and implement here instead of returning any

/**
 * Pogobuf typings created with <3 by hands.
 */
declare module 'pogobuf' {

    /**
     * Pokémon Go RPC client.
     */
    export class Client {
        playerLatitude: number;
        playerLongitude: number;

        /**
         * Sets the authentication type and token (required before making API calls).
         * @param {string} authType Authentication provider type (ptc or google)
         * @param {string} authToken Authentication token received from authentication provider
         */
        setAuthInfo(authType: string, authToken: string): void;

        /**
         * Sets the player's latitude and longitude.
         * Note that this does not actually update the player location on the server,
         * it only sets the location to be used in following API calls.
         * To update the location on the server you probably want to call playerUpdate().
         * @param {number} latitude The player's latitude
         * @param {number} longitude The player's longitude
         * @param {number} altitude The player's altitude (optional) (default value is 0)
         */
        setPosition(latitude: number, longitude: number, altitude?: number): void;

        /**
         * Performs the initial API call.
         */
        init(): Promise<any>;

        /**
         * Sets batch mode. All further API requests will be held and executed in one RPC call when batchCall() is called.
         */
        batchStart(): Client;

        /**
         * Clears the list of batched requests and aborts batch mode.
         */
        batchClear(): void;

        /**
         * Executes any batched requests.
         */
        batchCall(): Promise<any>;

        /**
         * Sets the maximum times to try RPC calls until they succeed (default is 5 tries).
         * Set to 1 to disable retry logic.
         * @param {number} maxTries
         */
        setMaxTries(maxTries: number): void;

        /**
         * Sets a proxy address to use for the HTTPS RPC requests.
         * @param {string} proxy
         */
        setProxy(proxy: string): void;

        /**
         * Enables or disables the built-in throttling of getMapObjects() calls based on the
         * minimum refresh setting received from the server. Enabled by default, disable if you
         * want to manage your own throttling.
         * @param {boolean} enable
         */
        setMapObjectsThrottlingEnabled(enable: boolean): void;

        /**
         * Enables or disables automatic conversion of Long.js
         * to primitive types in API response objects.
         * @param {boolean} enable
         */
        setAutomaticLongConversionEnabled(enable: boolean): void;


        // Pokémon Go API methods

        addFortModifier(modifierItemID, fortID: string): Promise<any>;

        attackGym(gymID, battleID, attackActions, lastRetrievedAction): Promise<any>;

        catchPokemon(encounterID, pokeballItemID, normalizedReticleSize, spawnPointID, hitPokemon, spinModifier, normalizedHitPosition): Promise<any>;

        checkAwardedBadges(): Promise<any>;

        checkCodenameAvailable(codename): Promise<any>;

        claimCodename(codename): Promise<any>;

        collectDailyBonus(): Promise<any>;

        collectDailyDefenderBonus(): Promise<any>;

        diskEncounter(encounterID, fortID): Promise<any>;

        downloadItemTemplates(): Promise<any>;

        downloadRemoteConfigVersion(platform, deviceManufacturer, deviceModel, locale, appVersion): Promise<any>;

        downloadSettings(hash): Promise<any>;

        echo(): Promise<any>;

        encounter(encounterID, spawnPointID): Promise<any>;

        encounterTutorialComplete(pokemonID): Promise<any>;

        equipBadge(badgeType): Promise<any>;

        evolvePokemon(pokemonID): Promise<any>;

        fortDeployPokemon(fortID, pokemonID): Promise<any>;

        fortDetails(fortID, fortLatitude, fortLongitude): Promise<any>;

        fortRecallPokemon(fortID, pokemonID): Promise<any>;

        fortSearch(fortID, fortLatitude, fortLongitude): Promise<any>;

        getAssetDigest(platform, deviceManufacturer, deviceModel, locale, appVersion): Promise<any>;

        getDownloadURLs(assetIDs): Promise<any>;

        getGymDetails(gymID, gymLatitude, gymLongitude): Promise<any>;

        getHatchedEggs(): Promise<any>;

        getIncensePokemon(): Promise<any>;

        getInventory(lastTimestamp): Promise<any>;

        getMapObjects(cellIDs: string[], sinceTimestamps: any): Promise<any>;

        getPlayer(appVersion): Promise<any>;

        getPlayerProfile(playerName): Promise<any>;

        getSuggestedCodenames(): Promise<any>;

        incenseEncounter(encounterID, encounterLocation): Promise<any>;

        levelUpRewards(level): Promise<any>;

        markTutorialComplete(tutorialsCompleted, sendMarketingEmails, sendPushNotifications): Promise<any>;

        nicknamePokemon(pokemonID, nickname): Promise<any>;

        playerUpdate(): Promise<any>;

        recycleInventoryItem(itemID, count): Promise<any>;

        releasePokemon(pokemonID): Promise<any>;

        setAvatar(skin, hair, shirt, pants, hat, shoes, gender, eyes, backpack): Promise<any>;

        setContactSettings(sendMarketingEmails, sendPushNotifications): Promise<any>;

        setFavoritePokemon(pokemonID, isFavorite): Promise<any>;

        setPlayerTeam(teamColor): Promise<any>;

        sfidaActionLog(): Promise<any>;

        startGymBattle(gymID, attackingPokemonIDs, defendingPokemonID): Promise<any>;

        upgradePokemon(pokemonID): Promise<any>;

        useIncense(itemID): Promise<any>;

        useItemCapture(itemID, encounterID, spawnPointID): Promise<any>;

        useItemEggIncubator(itemID, pokemonID): Promise<any>;

        useItemGym(itemID, gymID): Promise<any>;

        useItemPotion(itemID, pokemonID): Promise<any>;

        useItemRevive(itemID, pokemonID): Promise<any>;

        useItemXPBoost(itemID): Promise<any>;
    }

    /**
     * Pokémon Trainer Club login client.
     */
    export class PTCLogin {
        /**
         * Performs the PTC login process and returns a Promise that will be resolved with the auth token.
         * @param {string} username
         * @param {string} password
         */
        login(username: string, password: string): Promise<any>;
    }

    /**
     * Google login client.
     */
    export class GoogleLogin {
        /**
         * Performs the Google Login using Android Device and returns a Promise that will be resolved with the auth token.
         * @param {string} username
         * @param {string} password
         */
        login(username: string, password: string): Promise<any>;

        /**
         * Performs the Google login by skipping the password step and starting with the Master Token instead.
         * Returns a Promise that will be resolved with the auth token.
         * @param {string} username
         * @param {string} token
         */
        loginWithToken(username: string, token: string): Promise<any>;
    }

    /**
     * Various utilities for dealing with Pokémon Go API requests.
     */
    export module Utils {

        interface Inventory {
            pokemon: any[],
            items: any[],
            pokedex: any[],
            player: any,
            currency: any[],
            camera: any,
            inventory_upgrades: any[],
            applied_items: any[],
            egg_incubators: any[],
            candies: any[]
        }

        interface ItemTemplates {
            pokemon_settings: any[],
            item_settings: any[],
            move_settings: any[],
            move_sequence_settings: any[],
            type_effective_settings: any[],
            badge_settings: any[],
            camera_settings: any,
            player_level_settings: any,
            gym_level_settings: any,
            battle_settings: any,
            encounter_settings: any,
            iap_item_display: any[],
            iap_settings: any,
            pokemon_upgrade_settings: any,
            equipped_badge_settings: any
        }

        interface Stats {
            attack: any,
            defend: any,
            stamina: any,
            percent: any
        }

        /**
         * Provides cell IDs of nearby cells based on the given coords and radius
         * @param {number} latitude Latitude
         * @param {number} longitude Longitude
         * @param {number} radius Radius of the square in cells (optional) (default value is 3)
         */
        function getCellIDs(latitude: number, longitude: number, radius?: number): string[];

        /**
         * Takes a getInventory() response and separates it into pokemon, items, candies, player data, eggs, and pokedex.
         * @param {object} inventory API response message as returned by getInventory()
         */
        function splitInventory(inventory: Object): Inventory;

        /**
         * Takes a downloadItemTemplates() response and separates it into the individual settings objects.
         * @param {object} templates API response message as returned by downloadItemTemplates()
         */
        function splitItemTemplates(templates: Object): ItemTemplates;

        /**
         * Utility method that finds the name of the key for a given enum value and makes it look a little nicer.
         * @param {object} enumObjekt
         * @param {number} value
         */
        function getEnumKeyByValue(enumObjekt: Object, value: number): string;

        /**
         * Utility method to get the Individual Values from Pokémon
         * @param {object} pokemon A pokemon_data structure
         * @param {number} decimals Amount of decimals, negative values do not round, max 20
         */
        function getIVsFromPokemon(pokemon: Object, decimals: number): Stats;

        /**
         * Utility method to convert all Long.js objects to integers or strings
         * @param {object} object An object
         */
        function convertLongs(object: Object): Object;
    }
}
