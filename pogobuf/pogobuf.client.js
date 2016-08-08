'use strict';

const
    crypto = require('crypto'),
    EventEmitter = require('events').EventEmitter,
    Long = require('long'),
    POGOProtos = require('node-pogo-protos'),
    pogoSignature = require('node-pogo-signature'),
    Promise = require('bluebird'),
    request = require('request'),
    retry = require('bluebird-retry'),
    Utils = require('./pogobuf.utils.js');

const
    RequestType = POGOProtos.Networking.Requests.RequestType,
    RequestMessages = POGOProtos.Networking.Requests.Messages,
    Responses = POGOProtos.Networking.Responses;

const INITIAL_ENDPOINT = 'https://pgorelease.nianticlabs.com/plfe/rpc';

const DEFAULTOPTIONS = {
    proxy: null,
    mapObjectsThrottling: true,
    mapObjectsMinDelay: 5,
    maxTries: 5,
};

/**
 * Pokémon Go RPC client.
 * @class Client
 * @memberof pogobuf
 */
class Client extends EventEmitter {

    constructor() {
        super();
        this.authType = null;
        this.authToken = null;
        this.batchRequests = false;
    }

    /**
     * PUBLIC METHODS
     */

    /**
     * Sets the authentication type and token (required before making API calls).
     * @param {string} authType - Authentication provider type (ptc or google)
     * @param {string} authToken - Authentication token received from authentication provider
     */
    setAuthInfo(authType, authToken) {
        this.authType = authType;
        this.authToken = authToken;
    }

    /**
     * Sets the player's latitude and longitude.
     * Note that this does not actually update the player location on the server, it only sets
     * the location to be used in following API calls. To update the location on the server you
     * probably want to call {@link #updatePlayer}.
     * @param {number} latitude - The player's latitude
     * @param {number} longitude - The player's longitude
     * @param {number} [altitude=0] - The player's altitude
     */
    setPosition(latitude, longitude, altitude = 0) {
        this.playerLatitude = latitude;
        this.playerLongitude = longitude;
        this.playerAltitude = altitude;
    }

    /**
     * Performs the initial API call.
     * @param {string} object.proxy - Sets a proxy address to use for the HTTPS RPC requests.
     * @param {bool} object.mapObjectsThrottling - Enables or disables the built-in throttling of getMapObjects() calls
     * @param {number} object.mapObjectsMinDelay - Minimum delay between getMapObjects() calls
     * @param {number} object.maxTries - Maximum number of times to retry a RPC call when it fails
     * @return {Promise} promise
     */
    init(options = {}) {
        this.options = Object.assign({}, DEFAULTOPTIONS, options);
        // Internal values
        this.endpoint = INITIAL_ENDPOINT;
        this.signatureBuilder = new pogoSignature.Builder();
        this.lastMapObjectsCall = 0;
        // request default
        this.request = request.defaults({
            headers: {
                'User-Agent': 'Niantic App',
                'Accept': '*/*',
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            encoding: null
        });

        /*
            The response to the first RPC call does not contain any response messages even though
            the envelope includes requests, technically it wouldn't be necessary to send the
            requests but the app does the same. The call will then automatically be resent to the
            new API endpoint by callRPC().
        */
        return this.batchStart()
            .getPlayer('0.31.1')
            .getHatchedEggs()
            .getInventory()
            .checkAwardedBadges()
            .downloadSettings()
            .batchCall()
            .then(this.processInitialData);
    }

    /**
     * Sets batch mode. All further API requests will be held and executed in one RPC call when
     * {@link #batchCall} is called.
     * @return {Client} this
     */
    batchStart() {
        if (!this.batchRequests) {
            this.batchRequests = [];
        }
        return this;
    }

    /**
     * Clears the list of batched requests and aborts batch mode.
     */
    batchClear() {
        this.batchRequests = false;
    }

    /**
     * Executes any batched requests.
     * @return {Promise}
     */
    batchCall() {
        if (!this.batchRequests || this.batchRequests.length === 0) {
            return Promise.resolve(false);
        }

        let p = this.callRPC(this.batchRequests);

        this.batchClear();
        return p;
    }

    /**
     * Change a option in the client, see init for more info
     * @param {string} key - The name of the option
     * @param {mixed} val - The new value of the option
     */
    setOption(key, val) {
        if (this.options.hasOwnPropery(key)) {
            this.options[key] = val;
        }
    }

    /*
     * API CALLS (in order of RequestType enum)
     */

     /**
      * playerUpdate: Update current player position to server
      * @returns {promise} promise
      */
    playerUpdate() {
        return this.callOrChain({
            type: RequestType.PLAYER_UPDATE,
            message: new RequestMessages.PlayerUpdateMessage({
                latitude: this.playerLatitude,
                longitude: this.playerLongitude
            }),
            responseType: Responses.PlayerUpdateResponse
        });
    }

    /**
     * getPlayer: get player data
     * @param {string} appVersion - current app version eg. "0.31.1"
     */
    getPlayer(appVersion) {
        return this.callOrChain({
            type: RequestType.GET_PLAYER,
            message: new RequestMessages.GetPlayerMessage({
                app_version: appVersion
            }),
            responseType: Responses.GetPlayerResponse
        });
    }

    /**
     * getInventory: get the players inventory: bag, pokemon, eggs, pokedex,
     * upgrades, used items, currency and candies.
     * Util method `pogobuf.Utils.splitInventory` can be used on the result
     * @param {number} lastTimestamp - unknown, the app seems to always give 0
     */
    getInventory(lastTimestamp) {
        return this.callOrChain({
            type: RequestType.GET_INVENTORY,
            message: new RequestMessages.GetInventoryMessage({
                last_timestamp_ms: lastTimestamp
            }),
            responseType: Responses.GetInventoryResponse
        });
    }

    /**
     * downloadSettings: download the current app settings
     * @param {string} hash
     */
    downloadSettings(hash) {
        return this.callOrChain({
            type: RequestType.DOWNLOAD_SETTINGS,
            message: new RequestMessages.DownloadSettingsMessage({
                hash: hash
            }),
            responseType: Responses.DownloadSettingsResponse
        });
    }

    /**
     * downloadItemTemplates
     */
    downloadItemTemplates() {
        return this.callOrChain({
            type: RequestType.DOWNLOAD_ITEM_TEMPLATES,
            responseType: Responses.DownloadItemTemplatesResponse
        });
    }

    /**
     * downloadRemoteConfigVersion
     * @param {string} platform
     * @param {string} deviceManufacturer
     * @param {string} deviceModel
     * @param {string} locale
     * @param {string} appVersion
     */
    downloadRemoteConfigVersion(platform, deviceManufacturer, deviceModel, locale, appVersion) {
        return this.callOrChain({
            type: RequestType.DOWNLOAD_REMOTE_CONFIG_VERSION,
            message: new RequestMessages.DownloadRemoteConfigVersionMessage({
                platform: platform,
                device_manufacturer: deviceManufacturer,
                device_model: deviceModel,
                locale: locale,
                app_version: appVersion
            }),
            responseType: Responses.DownloadRemoteConfigVersionResponse
        });
    }

    /**
     * fortSearch: Spin a fort for rewards, does not work on gyms
     * @param {string} fortID
     * @param {string} fortLatitude
     * @param {string} fortLongitude
     */
    fortSearch(fortID, fortLatitude, fortLongitude) {
        return this.callOrChain({
            type: RequestType.FORT_SEARCH,
            message: new RequestMessages.FortSearchMessage({
                fort_id: fortID,
                player_latitude: this.playerLatitude,
                player_longitude: this.playerLongitude,
                fort_latitude: fortLatitude,
                fort_longitude: fortLongitude
            }),
            responseType: Responses.FortSearchResponse
        });
    }

    /**
     * encounter: Start a enncounter with specified nearby pokemon
     * @param {string} encounterID
     * @param {string} spawnPointID
     */
    encounter(encounterID, spawnPointID) {
        return this.callOrChain({
            type: RequestType.ENCOUNTER,
            message: new RequestMessages.EncounterMessage({
                encounter_id: encounterID,
                spawn_point_id: spawnPointID,
                player_latitude: this.playerLatitude,
                player_longitude: this.playerLongitude
            }),
            responseType: Responses.EncounterResponse
        });
    }

    /**
     * catchPokemon: throw a pokeball during a encounter
     * @param encounterID - encounter_id from the encounter
     * @param {number} pokeballItemID - Which pokeball 1 = normal, 2 = great, 3 = ultra
     * @param {string} normalizedReticleSize - Current size of the circle. eg. 1.950 for very small
     * @param spawnPointID - spawn_point_id from the encounter
     * @param {bool} hitPokemon - Did the pokeball hit the pokemon
     * @param {string} spinModifier - Curve ratio, eg. curve bonus: 0.850
     * @param {string} normalizedHitPosition - Where the pokeball hit the pokemon. 1.0 is center
     */
    catchPokemon(encounterID, pokeballItemID, normalizedReticleSize, spawnPointID, hitPokemon,
        spinModifier, normalizedHitPosition) {
        return this.callOrChain({
            type: RequestType.CATCH_POKEMON,
            message: new RequestMessages.CatchPokemonMessage({
                encounter_id: encounterID,
                pokeball: pokeballItemID,
                normalized_reticle_size: normalizedReticleSize,
                spawn_point_id: spawnPointID,
                hit_pokemon: hitPokemon,
                spin_modifier: spinModifier,
                normalized_hit_position: normalizedHitPosition
            }),
            responseType: Responses.CatchPokemonResponse
        });
    }

    /**
     * fortDetails: look up fort details
     * @param fortID
     * @param fortLatitude
     * @param fortLongitude
     */
    fortDetails(fortID, fortLatitude, fortLongitude) {
        return this.callOrChain({
            type: RequestType.FORT_DETAILS,
            message: new RequestMessages.FortDetailsMessage({
                fort_id: fortID,
                latitude: fortLatitude,
                longitude: fortLongitude
            }),
            responseType: Responses.FortDetailsResponse
        });
    }

    /**
     * getMapObjects: Load map data like forts and pokemon
     * @param {array} cellIDs - S2 geo cell IDs of which you want map data
     * @param {array} sinceTimestamps - Array of timestamps with same length of cellIDs
     */
    getMapObjects(cellIDs, sinceTimestamps) {
        return this.callOrChain({
            type: RequestType.GET_MAP_OBJECTS,
            message: new RequestMessages.GetMapObjectsMessage({
                cell_id: cellIDs,
                since_timestamp_ms: sinceTimestamps,
                latitude: this.playerLatitude,
                longitude: this.playerLongitude
            }),
            responseType: Responses.GetMapObjectsResponse
        });
    }

    /**
     * fortDeployPokemon
     * @param fortID
     * @param pokemonID
     */
    fortDeployPokemon(fortID, pokemonID) {
        return this.callOrChain({
            type: RequestType.FORT_DEPLOY_POKEMON,
            message: new RequestMessages.FortDeployPokemonMessage({
                fort_id: fortID,
                pokemon_id: pokemonID,
                player_latitude: this.playerLatitude,
                player_longitude: this.playerLongitude
            }),
            responseType: Responses.FortDeployPokemonResponse
        });
    }

    /**
     * fortRecallPokemon
     * @param fortID
     * @param pokemonID
     */
    fortRecallPokemon(fortID, pokemonID) {
        return this.callOrChain({
            type: RequestType.FORT_RECALL_POKEMON,
            message: new RequestMessages.FortRecallPokemonMessage({
                fort_id: fortID,
                pokemon_id: pokemonID,
                player_latitude: this.playerLatitude,
                player_longitude: this.playerLongitude
            }),
            responseType: Responses.FortRecallPokemonResponse
        });
    }

    /**
     * releasePokemon: known as "transfer", receive 1 candy for releasing
     * @param pokemonID
     */
    releasePokemon(pokemonID) {
        return this.callOrChain({
            type: RequestType.RELEASE_POKEMON,
            message: new RequestMessages.ReleasePokemonMessage({
                pokemon_id: pokemonID
            }),
            responseType: Responses.ReleasePokemonResponse
        });
    }

    /**
     * useItemPotion
     * @param itemID
     * @param pokemonID
     */
    useItemPotion(itemID, pokemonID) {
        return this.callOrChain({
            type: RequestType.USE_ITEM_POTION,
            message: new RequestMessages.UseItemPotionMessage({
                item_id: itemID,
                pokemon_id: pokemonID
            }),
            responseType: Responses.UseItemPotionResponse
        });
    }

    /**
     * useItemCapture
     * @param itemID
     * @param encounterID
     * @param spawnPointID
     */
    useItemCapture(itemID, encounterID, spawnPointID) {
        return this.callOrChain({
            type: RequestType.USE_ITEM_CAPTURE,
            message: new RequestMessages.UseItemCaptureMessage({
                item_id: itemID,
                encounter_id: encounterID,
                spawn_point_id: spawnPointID
            }),
            responseType: Responses.UseItemCaptureResponse
        });
    }

    /**
     * useItemRevive
     * @param {number} itemID
     * @param {number} pokemonID
     */
    useItemRevive(itemID, pokemonID) {
        return this.callOrChain({
            type: RequestType.USE_ITEM_REVIVE,
            message: new RequestMessages.UseItemReviveMessage({
                item_id: itemID,
                pokemon_id: pokemonID
            }),
            responseType: Responses.UseItemReviveResponse
        });
    }

    /**
     * getPlayerProfile
     * @param {string} playerName
     */
    getPlayerProfile(playerName) {
        return this.callOrChain({
            type: RequestType.GET_PLAYER_PROFILE,
            message: new RequestMessages.GetPlayerProfileMessage({
                player_name: playerName
            }),
            responseType: Responses.GetPlayerProfileResponse
        });
    }

    /**
     * getPlayerProfile
     * @param {number} pokemonID
     */
    evolvePokemon(pokemonID) {
        return this.callOrChain({
            type: RequestType.EVOLVE_POKEMON,
            message: new RequestMessages.EvolvePokemonMessage({
                pokemon_id: pokemonID
            }),
            responseType: Responses.EvolvePokemonResponse
        });
    }

    /**
     * getHatchedEggs
     */
    getHatchedEggs() {
        return this.callOrChain({
            type: RequestType.GET_HATCHED_EGGS,
            responseType: Responses.GetHatchedEggsResponse
        });
    }

    /**
     * encounterTutorialComplete
     * @param {number} pokemonID
     */
    encounterTutorialComplete(pokemonID) {
        return this.callOrChain({
            type: RequestType.ENCOUNTER_TUTORIAL_COMPLETE,
            message: new RequestMessages.EncounterTutorialCompleteMessage({
                pokemon_id: pokemonID
            }),
            responseType: Responses.EncounterTutorialCompleteResponse
        });
    }

    /**
     * levelUpRewards
     * @param {number} level
     */
    levelUpRewards(level) {
        return this.callOrChain({
            type: RequestType.LEVEL_UP_REWARDS,
            message: new RequestMessages.LevelUpRewardsMessage({
                level: level
            }),
            responseType: Responses.LevelUpRewardsResponse
        });
    }

    checkAwardedBadges() {
        return this.callOrChain({
            type: RequestType.CHECK_AWARDED_BADGES,
            responseType: Responses.CheckAwardedBadgesResponse
        });
    }

    useItemGym(itemID, gymID) {
        return this.callOrChain({
            type: RequestType.USE_ITEM_GYM,
            message: new RequestMessages.UseItemGymMessage({
                item_id: itemID,
                gym_id: gymID,
                player_latitude: this.playerLatitude,
                player_longitude: this.playerLongitude
            }),
            responseType: Responses.UseItemGymResponse
        });
    }

    getGymDetails(gymID, gymLatitude, gymLongitude) {
        return this.callOrChain({
            type: RequestType.GET_GYM_DETAILS,
            message: new RequestMessages.GetGymDetailsMessage({
                gym_id: gymID,
                player_latitude: this.playerLatitude,
                player_longitude: this.playerLongitude,
                gym_latitude: gymLatitude,
                gym_longitude: gymLongitude
            }),
            responseType: Responses.GetGymDetailsResponse
        });
    }

    startGymBattle(gymID, attackingPokemonIDs, defendingPokemonID) {
        return this.callOrChain({
            type: RequestType.START_GYM_BATTLE,
            message: new RequestMessages.StartGymBattleMessage({
                gym_id: gymID,
                attacking_pokemon_ids: attackingPokemonIDs,
                defending_pokemon_id: defendingPokemonID,
                player_latitude: this.playerLatitude,
                player_longitude: this.playerLongitude
            }),
            responseType: Responses.StartGymBattleResponse
        });
    }

    attackGym(gymID, battleID, attackActions, lastRetrievedAction) {
        return this.callOrChain({
            type: RequestType.ATTACK_GYM,
            message: new RequestMessages.AttackGymMessage({
                gym_id: gymID,
                battle_id: battleID,
                attack_actions: attackActions,
                last_retrieved_actions: lastRetrievedAction,
                player_latitude: this.playerLatitude,
                player_longitude: this.playerLongitude
            }),
            responseType: Responses.AttackGymResponse
        });
    }

    recycleInventoryItem(itemID, count) {
        return this.callOrChain({
            type: RequestType.RECYCLE_INVENTORY_ITEM,
            message: new RequestMessages.RecycleInventoryItemMessage({
                item_id: itemID,
                count: count
            }),
            responseType: Responses.RecycleInventoryItemResponse
        });
    }

    collectDailyBonus() {
        return this.callOrChain({
            type: RequestType.COLLECT_DAILY_BONUS,
            responseType: Responses.CollectDailyBonusResponse
        });
    }

    useItemXPBoost(itemID) {
        return this.callOrChain({
            type: RequestType.USE_ITEM_XP_BOOST,
            message: new RequestMessages.UseItemXpBoostMessage({
                item_id: itemID
            }),
            responseType: Responses.UseItemXpBoostResponse
        });
    }

    useItemEggIncubator(itemID, pokemonID) {
        return this.callOrChain({
            type: RequestType.USE_ITEM_EGG_INCUBATOR,
            message: new RequestMessages.UseItemEggIncubatorMessage({
                item_id: itemID,
                pokemon_id: pokemonID
            }),
            responseType: Responses.UseItemEggIncubatorResponse
        });
    }

    useIncense(itemID) {
        return this.callOrChain({
            type: RequestType.USE_INCENSE,
            message: new RequestMessages.UseIncenseMessage({
                incense_type: itemID
            }),
            responseType: Responses.UseIncenseResponse
        });
    }

    getIncensePokemon() {
        return this.callOrChain({
            type: RequestType.GET_INCENSE_POKEMON,
            message: new RequestMessages.GetIncensePokemonMessage({
                player_latitude: this.playerLatitude,
                player_longitude: this.playerLongitude
            }),
            responseType: Responses.GetIncensePokmeonResponse
        });
    }

    incenseEncounter(encounterID, encounterLocation) {
        return this.callOrChain({
            type: RequestType.INCENSE_ENCOUNTER,
            message: new RequestMessages.IncenseEncounterMessage({
                encounter_id: encounterID,
                encounter_location: encounterLocation
            }),
            responseType: Responses.IncenseEncounterResponse
        });
    }

    addFortModifier(modifierItemID, fortID) {
        return this.callOrChain({
            type: RequestType.ADD_FORT_MODIFIER,
            message: new RequestMessages.AddFortModifierMessage({
                modifier_type: modifierItemID,
                fort_id: fortID,
                player_latitude: this.playerLatitude,
                player_longitude: this.playerLongitude
            })
        });
    }

    diskEncounter(encounterID, fortID) {
        return this.callOrChain({
            type: RequestType.DISK_ENCOUNTER,
            message: new RequestMessages.DiskEncounterMessage({
                encounter_id: encounterID,
                fort_id: fortID,
                player_latitude: this.playerLatitude,
                player_longitude: this.playerLongitude
            }),
            responseType: Responses.DiskEncounterResponse
        });
    }

    collectDailyDefenderBonus() {
        return this.callOrChain({
            type: RequestType.COLLECT_DAILY_DEFENDER_BONUS,
            responseType: Responses.CollectDailyDefenderBonusResponse
        });
    }

    upgradePokemon(pokemonID) {
        return this.callOrChain({
            type: RequestType.UPGRADE_POKEMON,
            message: new RequestMessages.UpgradePokemonMessage({
                pokemon_id: pokemonID
            }),
            responseType: Responses.UpgradePokemonResponse
        });
    }

    setFavoritePokemon(pokemonID, isFavorite) {
        return this.callOrChain({
            type: RequestType.SET_FAVORITE_POKEMON,
            message: new RequestMessages.SetFavoritePokemonMessage({
                pokemon_id: pokemonID,
                is_favorite: isFavorite
            }),
            responseType: Responses.SetFavoritePokemonResponse
        });
    }

    nicknamePokemon(pokemonID, nickname) {
        return this.callOrChain({
            type: RequestType.NICKNAME_POKEMON,
            message: new RequestMessages.NicknamePokemonMessage({
                pokemon_id: pokemonID,
                nickname: nickname
            }),
            responseType: Responses.NicknamePokemonResponse
        });
    }

    equipBadge(badgeType) {
        return this.callOrChain({
            type: RequestType.EQUIP_BADGE,
            message: new RequestMessages.EquipBadgeMessage({
                badge_type: badgeType
            }),
            responseType: Responses.EquipBadgeResponse
        });
    }

    setContactSettings(sendMarketingEmails, sendPushNotifications) {
        return this.callOrChain({
            type: RequestType.SET_CONTACT_SETTINGS,
            message: new RequestMessages.SetContactSettingsMessage({
                contact_settings: {
                    send_marketing_emails: sendMarketingEmails,
                    send_push_notifications: sendPushNotifications
                }
            }),
            responseType: Responses.SetContactSettingsResponse
        });
    }

    getAssetDigest(platform, deviceManufacturer, deviceModel, locale, appVersion) {
        return this.callOrChain({
            type: RequestType.GET_ASSET_DIGEST,
            message: new RequestMessages.GetAssetDigestMessage({
                platform: platform,
                device_manufacturer: deviceManufacturer,
                device_model: deviceModel,
                locale: locale,
                app_version: appVersion
            }),
            responseType: Responses.GetAssetDigestResponse
        });
    }

    getDownloadURLs(assetIDs) {
        return this.callOrChain({
            type: RequestType.GET_DOWNLOAD_URLS,
            message: new RequestMessages.GetDownloadUrlsMessage({
                asset_id: assetIDs
            }),
            responseType: Responses.GetDownloadUrlsResponse
        });
    }

    getSuggestedCodenames() {
        return this.callOrChain({
            type: RequestType.GET_SUGGESTED_CODENAMES,
            responseType: Responses.GetSuggestedCodenamesResponse
        });
    }

    checkCodenameAvailable(codename) {
        return this.callOrChain({
            type: RequestType.CHECK_CODENAME_AVAILABLE,
            message: new RequestMessages.CheckCodenameAvailableMessage({
                codename: codename
            }),
            responseType: Responses.CheckCodenameAvailableResponse
        });
    }

    claimCodename(codename) {
        return this.callOrChain({
            type: RequestType.CLAIM_CODENAME,
            message: new RequestMessages.ClaimCodenameMessage({
                codename: codename
            }),
            responseType: Responses.ClaimCodenameResponse
        });
    }

    setAvatar(skin, hair, shirt, pants, hat, shoes, gender, eyes, backpack) {
        return this.callOrChain({
            type: RequestType.SET_AVATAR,
            message: new RequestMessages.SetAvatarMessage({
                player_avatar: {
                    skin: skin,
                    hair: hair,
                    shirt: shirt,
                    pants: pants,
                    hat: hat,
                    shoes: shoes,
                    gender: gender,
                    eyes: eyes,
                    backpack: backpack
                }
            }),
            responseType: Responses.SetAvatarResponse
        });
    }

    setPlayerTeam(teamColor) {
        return this.callOrChain({
            type: RequestType.SET_PLAYER_TEAM,
            message: new RequestMessages.SetPlayerTeamMessage({
                team: teamColor
            }),
            responseType: Responses.SetPlayerTeamResponse
        });
    }

    markTutorialComplete(tutorialsCompleted, sendMarketingEmails, sendPushNotifications) {
        return this.callOrChain({
            type: RequestType.MARK_TUTORIAL_COMPLETE,
            message: new RequestMessages.MarkTutorialCompleteMessage({
                tutorials_completed: tutorialsCompleted,
                send_marketing_emails: sendMarketingEmails,
                send_push_notifications: sendPushNotifications
            }),
            responseType: Responses.MarkTutorialCompleteResponse
        });
    }

    echo() {
        return this.callOrChain({
            type: RequestType.ECHO,
            responseType: Responses.EchoResponse
        });
    }

    sfidaActionLog() {
        return this.callOrChain({
            type: RequestType.SFIDA_ACTION_LOG,
            responseType: Responses.SfidaActionLogResponse
        });
    }


    /**
     * Executes a request and returns a Promise or, if we are in batch mode, adds it to the
     * list of batched requests and returns this (for chaining).
     * @private
     * @param {object} requestMessage - RPC request object
     * @return {Promise|Client}
     */
    callOrChain(requestMessage) {
        if (this.batchRequests) {
            this.batchRequests.push(requestMessage);
            return this;
        } else {
            return this.callRPC([requestMessage]);
        }
    };

    /**
     * Generates a random request ID
     * @private
     * @return {Long}
     */
    getRequestID() {
        var bytes = crypto.randomBytes(8);
        return Long.fromBits(
            bytes[0] << 24 | bytes[1] << 16 | bytes[2] << 8 | bytes[3],
            bytes[4] << 24 | bytes[5] << 16 | bytes[6] << 8 | bytes[7],
            true
        );
    }

    /**
     * Creates an RPC envelope with the given list of requests.
     * @private
     * @param {Object[]} requests - Array of requests to build
     * @return {POGOProtos.Networking.Envelopes.RequestEnvelope}
     */
    buildEnvelope(requests) {
        var envelopeData = {
            status_code: 2,
            request_id: this.getRequestID(),
            unknown12: 989
        };

        if (this.playerLatitude) envelopeData.latitude = this.playerLatitude;
        if (this.playerLongitude) envelopeData.longitude = this.playerLongitude;
        if (this.playerAltitude) envelopeData.altitude = this.playerAltitude;

        if (this.authTicket) {
            envelopeData.auth_ticket = this.authTicket;
        } else if (!this.authType || !this.authToken) {
            throw Error('No auth info provided');
        } else {
            envelopeData.auth_info = {
                provider: this.authType,
                token: {
                    contents: this.authToken,
                    unknown2: 59
                }
            };
        }

        if (requests) {
            this.emit('request', {
                request_id: envelopeData.request_id.toString(),
                requests: requests.map(r => ({
                    name: Utils.getEnumKeyByValue(RequestType, r.type),
                    type: r.type,
                    data: r.message
                }))
            });

            envelopeData.requests = requests.map(r => {
                var requestData = {
                    request_type: r.type
                };

                if (r.message) {
                    requestData.request_message = r.message.encode();
                }

                return requestData;
            });
        }

        this.emit('raw-request', envelopeData);

        return new POGOProtos.Networking.Envelopes.RequestEnvelope(envelopeData);
    }

    /**
     * Creates an RPC envelope with the given list of requests and adds the encrypted signature,
     * or adds the signature to an existing envelope.
     * @private
     * @param {Object[]} requests - Array of requests to build
     * @param {RequestEnvelope} [envelope] - Pre-built request envelope to sign
     * @return {Promise} - A Promise that will be resolved with a RequestEnvelope instance
     */
    buildSignedEnvelope(requests, envelope) {
        return new Promise((resolve, reject) => {
            if (!envelope) {
                try {
                    envelope = this.buildEnvelope(requests);
                } catch (e) {
                    reject(new retry.StopError(e));
                }
            }

            if (!envelope.auth_ticket) {
                // Can't sign before we have received an auth ticket
                resolve(envelope);
                return;
            }

            this.signatureBuilder.setAuthTicket(envelope.auth_ticket);
            this.signatureBuilder.setLocation(envelope.latitude, envelope.longitude, envelope.altitude);

            this.signatureBuilder.encrypt(envelope.requests, (err, sigEncrypted) => {
                if (err) {
                    reject(new retry.StopError(err));
                    return;
                }

                envelope.unknown6.push(new POGOProtos.Networking.Envelopes.Unknown6({
                    request_type: 6,
                    unknown2: new POGOProtos.Networking.Envelopes.Unknown6.Unknown2({
                        encrypted_signature: sigEncrypted
                    })
                }));

                resolve(envelope);
            });
        });
    }

    /**
     * Executes an RPC call with the given list of requests, retrying if necessary.
     * @private
     * @param {Object[]} requests - Array of requests to send
     * @param {RequestEnvelope} [envelope] - Pre-built request envelope to use
     * @return {Promise} - A Promise that will be resolved with the (list of) response messages,
     *     or true if there aren't any
     */
    callRPC(requests, envelope) {
        // If the requests include a map objects request, make sure the minimum delay
        // since the last call has passed
        if (requests.some(r => r.type === RequestType.GET_MAP_OBJECTS)) {
            var now = new Date().getTime(),
                delayNeeded = this.lastMapObjectsCall + (this.mapObjectsMinDelay * 1000) - now;

            if (delayNeeded > 0 && this.mapObjectsThrottlingEnabled) {
                return Promise.delay(delayNeeded).then(() => this.callRPC(requests, envelope));
            }

            this.lastMapObjectsCall = now;
        }

        if (this.maxTries <= 1) return this.tryCallRPC(requests, envelope);

        return retry(() => this.tryCallRPC(requests, envelope), {
            interval: 300,
            backoff: 2,
            max_tries: this.maxTries
        });
    }

    /**
     * Executes an RPC call with the given list of requests.
     * @private
     * @param {Object[]} requests - Array of requests to send
     * @param {RequestEnvelope} [envelope] - Pre-built request envelope to use
     * @return {Promise} - A Promise that will be resolved with the (list of) response messages,
     *     or true if there aren't any
     */
    tryCallRPC(requests, envelope) {
        return this.buildSignedEnvelope(requests, envelope)
            .then(signedEnvelope => new Promise((resolve, reject) => {
                this.request({
                    method: 'POST',
                    url: this.endpoint,
                    proxy: this.proxy,
                    body: signedEnvelope.toBuffer()
                }, (err, response, body) => {
                    if (err) {
                        reject(Error(err));
                        return;
                    }

                    if (response.statusCode !== 200) {
                        if (response.statusCode >= 400 && response.statusCode < 500) {
                            /* These are permanent errors so throw StopError */
                            reject(new retry.StopError(
                                `Status code ${response.statusCode} received from HTTPS request`));
                        } else {
                            /* Anything else might be recoverable so throw regular Error */
                            reject(Error(`Status code ${response.statusCode} received from HTTPS request`));
                        }
                        return;
                    }

                    var responseEnvelope;
                    try {
                        responseEnvelope = POGOProtos.Networking.Envelopes.ResponseEnvelope.decode(body);
                    } catch (e) {
                        this.emit('parse-envelope-error', body, e);
                        if (e.decoded) {
                            responseEnvelope = e.decoded;
                        } else {
                            reject(new retry.StopError(e));
                            return;
                        }
                    }

                    this.emit('raw-response', responseEnvelope);

                    if (responseEnvelope.error) {
                        reject(new retry.StopError(responseEnvelope.error));
                        return;
                    }

                    if (responseEnvelope.auth_ticket) this.authTicket = responseEnvelope.auth_ticket;

                    if (this.endpoint === INITIAL_ENDPOINT) {
                        /* status_code 102 seems to be invalid auth token,
                           could use later when caching token. */
                        if (responseEnvelope.status_code !== 53) {
                            reject(Error('Fetching RPC endpoint failed, received status code ' +
                                responseEnvelope.status_code));
                            return;
                        }

                        if (!responseEnvelope.api_url) {
                            reject(Error('Fetching RPC endpoint failed, none supplied in response'));
                            return;
                        }

                        this.endpoint = 'https://' + responseEnvelope.api_url + '/rpc';

                        this.emit('endpoint-response', {
                            status_code: responseEnvelope.status_code,
                            request_id: responseEnvelope.request_id.toString(),
                            api_url: responseEnvelope.api_url
                        });

                        resolve(this.callRPC(requests, envelope));
                        return;
                    }

                    /* These codes indicate invalid input, no use in retrying so throw StopError */
                    if (responseEnvelope.status_code === 3 || responseEnvelope.status_code === 102) {
                        reject(new retry.StopError(
                            `Status code ${responseEnvelope.status_code} received from RPC`));
                    }

                    /* These can be temporary so throw regular Error */
                    if (responseEnvelope.status_code !== 2 && responseEnvelope.status_code !== 1) {
                        reject(Error(`Status code ${responseEnvelope.status_code} received from RPC`));
                        return;
                    }

                    var responses = [];

                    if (requests) {
                        if (requests.length !== responseEnvelope.returns.length) {
                            reject(Error('Request count does not match response count'));
                            return;
                        }

                        for (var i = 0; i < responseEnvelope.returns.length; i++) {
                            if (!requests[i].responseType) continue;

                            var responseMessage;
                            try {
                                responseMessage = requests[i].responseType.decode(responseEnvelope.returns[
                                    i]);
                            } catch (e) {
                                this.emit('parse-response-error', responseEnvelope.returns[i].toBuffer(), e);
                                reject(new retry.StopError(e));
                                return;
                            }

                            responses.push(responseMessage);
                        }
                    }

                    this.emit('response', {
                        status_code: responseEnvelope.status_code,
                        request_id: responseEnvelope.request_id.toString(),
                        responses: responses.map((r, h) => ({
                            name: Utils.getEnumKeyByValue(RequestType, requests[h].type),
                            type: requests[h].type,
                            data: r
                        }))
                    });

                    if (!responses.length) resolve(true);
                    else if (responses.length === 1) resolve(responses[0]);
                    else resolve(responses);
                });
            }));
    }

    /**
     * Processes the data received from the initial API call during init().
     * @private
     * @param {Object[]} responses - Respones from API call
     * @return {Object[]} respones - Unomdified responses (to send back to Promise)
     */
     processInitialData(responses) {
        // Extract the minimum delay of getMapObjects()
        if (responses.length >= 5) {
            var settingsResponse = responses[4];
            if (!settingsResponse.error &&
                settingsResponse.settings &&
                settingsResponse.settings.map_settings &&
                settingsResponse.settings.map_settings.get_map_objects_min_refresh_seconds
            ) {
                this.mapObjectsMinDelay =
                    settingsResponse.settings.map_settings.get_map_objects_min_refresh_seconds * 1000;
            }
        }
        return responses;
    }
}

module.exports = Client;
