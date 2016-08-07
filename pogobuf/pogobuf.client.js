'use strict';

const crypto = require('crypto'),
    EventEmitter = require('events').EventEmitter,
    Long = require('long'),
    POGOProtos = require('node-pogo-protos'),
    pogoSignature = require('node-pogo-signature'),
    Promise = require('bluebird'),
    request = require('request'),
    retry = require('bluebird-retry'),
    Utils = require('./pogobuf.utils.js');

const RequestType = POGOProtos.Networking.Requests.RequestType,
    RequestMessages = POGOProtos.Networking.Requests.Messages,
    Responses = POGOProtos.Networking.Responses;

const INITIAL_ENDPOINT = 'https://pgorelease.nianticlabs.com/plfe/rpc';
const DEFAULT_MAP_OBJECTS_DELAY = 5;

/**
 * Pokémon Go RPC client.
 * @class Client
 * @memberof pogobuf
 */
function Client() {
    if (!(this instanceof Client)) {
        return new Client();
    }
    const self = this;

    /**
     * PUBLIC METHODS
     */

    /**
     * Sets the authentication type and token (required before making API calls).
     * @param {string} authType - Authentication provider type (ptc or google)
     * @param {string} authToken - Authentication token received from authentication provider
     */
    this.setAuthInfo = function(authType, authToken) {
        self.authType = authType;
        self.authToken = authToken;
    };

    /**
     * Sets the player's latitude and longitude.
     * Note that this does not actually update the player location on the server, it only sets
     * the location to be used in following API calls. To update the location on the server you
     * probably want to call {@link #updatePlayer}.
     * @param {number} latitude - The player's latitude
     * @param {number} longitude - The player's longitude
     * @param {number} [altitude=0] - The player's altitude
     */
    this.setPosition = function(latitude, longitude, altitude) {
        self.playerLatitude = latitude;
        self.playerLongitude = longitude;
        self.playerAltitude = altitude || 0;
    };

    /**
     * Performs the initial API call.
     * @return {Promise} promise
     */
    this.init = function() {
        self.signatureBuilder = new pogoSignature.Builder();
        self.lastMapObjectsCall = 0;

        /*
            The response to the first RPC call does not contain any response messages even though
            the envelope includes requests, technically it wouldn't be necessary to send the
            requests but the app does the same. The call will then automatically be resent to the
            new API endpoint by callRPC().
        */
        self.endpoint = INITIAL_ENDPOINT;

        return self.batchStart()
            .getPlayer('0.31.1')
            .getHatchedEggs()
            .getInventory()
            .checkAwardedBadges()
            .downloadSettings()
            .batchCall()
            .then(self.processInitialData);
    };

    /**
     * Sets batch mode. All further API requests will be held and executed in one RPC call when
     * {@link #batchCall} is called.
     * @return {Client} this
     */
    this.batchStart = function() {
        if (!self.batchRequests) {
            self.batchRequests = [];
        }
        return self;
    };

    /**
     * Clears the list of batched requests and aborts batch mode.
     */
    this.batchClear = function() {
        delete self.batchRequests;
    };

    /**
     * Executes any batched requests.
     * @return {Promise}
     */
    this.batchCall = function() {
        if (!self.batchRequests || !self.batchRequests.length) {
            return Promise.resolve(false);
        }

        var p = self.callRPC(self.batchRequests);

        self.batchClear();
        return p;
    };

    /**
     * Sets the maximum times to try RPC calls until they succeed (default is 5 tries).
     * Set to 1 to disable retry logic.
     * @param {integer} maxTries
     */
    this.setMaxTries = function(maxTries) {
        self.maxTries = maxTries;
    };

    /**
     * Sets a proxy address to use for the HTTPS RPC requests.
     * @param {string} proxy
     */
    this.setProxy = function(proxy) {
        self.proxy = proxy;
    };

    /**
     * Enables or disables the built-in throttling of getMapObjects() calls based on the
     * minimum refresh setting received from the server. Enabled by default, disable if you
     * want to manage your own throttling.
     * @param {boolean} enable
     */
    this.setMapObjectsThrottlingEnabled = function(enable) {
        self.mapObjectsThrottlingEnabled = enable;
    };

    /**
     * Sets a callback to be called for any envelope or request just before it is sent to
     * the server (mostly for debugging purposes).
     * @deprecated Use the raw-request event instead
     * @param {function} callback - function to call on requests
     */
    this.setRequestCallback = function(callback) {
        self.on('raw-request', callback);
    };

    /**
     * Sets a callback to be called for any envelope or response just after it has been
     * received from the server (mostly for debugging purposes).
     * @deprecated Use the raw-response event instead
     * @param {function} callback - function to call on responses
     */
    this.setResponseCallback = function(callback) {
        self.on('raw-response', callback);
    };

    /*
     * API CALLS (in order of RequestType enum)
     */

    this.playerUpdate = function() {
        return self.callOrChain({
            type: RequestType.PLAYER_UPDATE,
            message: new RequestMessages.PlayerUpdateMessage({
                latitude: self.playerLatitude,
                longitude: self.playerLongitude
            }),
            responseType: Responses.PlayerUpdateResponse
        });
    };

    this.getPlayer = function(appVersion) {
        return self.callOrChain({
            type: RequestType.GET_PLAYER,
            message: new RequestMessages.GetPlayerMessage({
                app_version: appVersion
            }),
            responseType: Responses.GetPlayerResponse
        });
    };

    this.getInventory = function(lastTimestamp) {
        return self.callOrChain({
            type: RequestType.GET_INVENTORY,
            message: new RequestMessages.GetInventoryMessage({
                last_timestamp_ms: lastTimestamp
            }),
            responseType: Responses.GetInventoryResponse
        });
    };

    this.downloadSettings = function(hash) {
        return self.callOrChain({
            type: RequestType.DOWNLOAD_SETTINGS,
            message: new RequestMessages.DownloadSettingsMessage({
                hash: hash
            }),
            responseType: Responses.DownloadSettingsResponse
        });
    };

    this.downloadItemTemplates = function() {
        return self.callOrChain({
            type: RequestType.DOWNLOAD_ITEM_TEMPLATES,
            responseType: Responses.DownloadItemTemplatesResponse
        });
    };

    this.downloadRemoteConfigVersion = function(platform, deviceManufacturer, deviceModel, locale, appVersion) {
        return self.callOrChain({
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
    };

    this.fortSearch = function(fortID, fortLatitude, fortLongitude) {
        return self.callOrChain({
            type: RequestType.FORT_SEARCH,
            message: new RequestMessages.FortSearchMessage({
                fort_id: fortID,
                player_latitude: self.playerLatitude,
                player_longitude: self.playerLongitude,
                fort_latitude: fortLatitude,
                fort_longitude: fortLongitude
            }),
            responseType: Responses.FortSearchResponse
        });
    };

    this.encounter = function(encounterID, spawnPointID) {
        return self.callOrChain({
            type: RequestType.ENCOUNTER,
            message: new RequestMessages.EncounterMessage({
                encounter_id: encounterID,
                spawn_point_id: spawnPointID,
                player_latitude: self.playerLatitude,
                player_longitude: self.playerLongitude
            }),
            responseType: Responses.EncounterResponse
        });
    };

    this.catchPokemon = function(encounterID, pokeballItemID, normalizedReticleSize, spawnPointID, hitPokemon,
        spinModifier, normalizedHitPosition) {
        return self.callOrChain({
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
    };

    this.fortDetails = function(fortID, fortLatitude, fortLongitude) {
        return self.callOrChain({
            type: RequestType.FORT_DETAILS,
            message: new RequestMessages.FortDetailsMessage({
                fort_id: fortID,
                latitude: fortLatitude,
                longitude: fortLongitude
            }),
            responseType: Responses.FortDetailsResponse
        });
    };

    this.getMapObjects = function(cellIDs, sinceTimestamps) {
        return self.callOrChain({
            type: RequestType.GET_MAP_OBJECTS,
            message: new RequestMessages.GetMapObjectsMessage({
                cell_id: cellIDs,
                since_timestamp_ms: sinceTimestamps,
                latitude: self.playerLatitude,
                longitude: self.playerLongitude
            }),
            responseType: Responses.GetMapObjectsResponse
        });
    };

    this.fortDeployPokemon = function(fortID, pokemonID) {
        return self.callOrChain({
            type: RequestType.FORT_DEPLOY_POKEMON,
            message: new RequestMessages.FortDeployPokemonMessage({
                fort_id: fortID,
                pokemon_id: pokemonID,
                player_latitude: self.playerLatitude,
                player_longitude: self.playerLongitude
            }),
            responseType: Responses.FortDeployPokemonResponse
        });
    };

    this.fortRecallPokemon = function(fortID, pokemonID) {
        return self.callOrChain({
            type: RequestType.FORT_RECALL_POKEMON,
            message: new RequestMessages.FortRecallPokemonMessage({
                fort_id: fortID,
                pokemon_id: pokemonID,
                player_latitude: self.playerLatitude,
                player_longitude: self.playerLongitude
            }),
            responseType: Responses.FortRecallPokemonResponse
        });
    };

    this.releasePokemon = function(pokemonID) {
        return self.callOrChain({
            type: RequestType.RELEASE_POKEMON,
            message: new RequestMessages.ReleasePokemonMessage({
                pokemon_id: pokemonID
            }),
            responseType: Responses.ReleasePokemonResponse
        });
    };

    this.useItemPotion = function(itemID, pokemonID) {
        return self.callOrChain({
            type: RequestType.USE_ITEM_POTION,
            message: new RequestMessages.UseItemPotionMessage({
                item_id: itemID,
                pokemon_id: pokemonID
            }),
            responseType: Responses.UseItemPotionResponse
        });
    };

    this.useItemCapture = function(itemID, encounterID, spawnPointID) {
        return self.callOrChain({
            type: RequestType.USE_ITEM_CAPTURE,
            message: new RequestMessages.UseItemCaptureMessage({
                item_id: itemID,
                encounter_id: encounterID,
                spawn_point_id: spawnPointID
            }),
            responseType: Responses.UseItemCaptureResponse
        });
    };

    this.useItemRevive = function(itemID, pokemonID) {
        return self.callOrChain({
            type: RequestType.USE_ITEM_REVIVE,
            message: new RequestMessages.UseItemReviveMessage({
                item_id: itemID,
                pokemon_id: pokemonID
            }),
            responseType: Responses.UseItemReviveResponse
        });
    };

    this.getPlayerProfile = function(playerName) {
        return self.callOrChain({
            type: RequestType.GET_PLAYER_PROFILE,
            message: new RequestMessages.GetPlayerProfileMessage({
                player_name: playerName
            }),
            responseType: Responses.GetPlayerProfileResponse
        });
    };

    this.evolvePokemon = function(pokemonID) {
        return self.callOrChain({
            type: RequestType.EVOLVE_POKEMON,
            message: new RequestMessages.EvolvePokemonMessage({
                pokemon_id: pokemonID
            }),
            responseType: Responses.EvolvePokemonResponse
        });
    };

    this.getHatchedEggs = function() {
        return self.callOrChain({
            type: RequestType.GET_HATCHED_EGGS,
            responseType: Responses.GetHatchedEggsResponse
        });
    };

    this.encounterTutorialComplete = function(pokemonID) {
        return self.callOrChain({
            type: RequestType.ENCOUNTER_TUTORIAL_COMPLETE,
            message: new RequestMessages.EncounterTutorialCompleteMessage({
                pokemon_id: pokemonID
            }),
            responseType: Responses.EncounterTutorialCompleteResponse
        });
    };

    this.levelUpRewards = function(level) {
        return self.callOrChain({
            type: RequestType.LEVEL_UP_REWARDS,
            message: new RequestMessages.LevelUpRewardsMessage({
                level: level
            }),
            responseType: Responses.LevelUpRewardsResponse
        });
    };

    this.checkAwardedBadges = function() {
        return self.callOrChain({
            type: RequestType.CHECK_AWARDED_BADGES,
            responseType: Responses.CheckAwardedBadgesResponse
        });
    };

    this.useItemGym = function(itemID, gymID) {
        return self.callOrChain({
            type: RequestType.USE_ITEM_GYM,
            message: new RequestMessages.UseItemGymMessage({
                item_id: itemID,
                gym_id: gymID,
                player_latitude: self.playerLatitude,
                player_longitude: self.playerLongitude
            }),
            responseType: Responses.UseItemGymResponse
        });
    };

    this.getGymDetails = function(gymID, gymLatitude, gymLongitude) {
        return self.callOrChain({
            type: RequestType.GET_GYM_DETAILS,
            message: new RequestMessages.GetGymDetailsMessage({
                gym_id: gymID,
                player_latitude: self.playerLatitude,
                player_longitude: self.playerLongitude,
                gym_latitude: gymLatitude,
                gym_longitude: gymLongitude
            }),
            responseType: Responses.GetGymDetailsResponse
        });
    };

    this.startGymBattle = function(gymID, attackingPokemonIDs, defendingPokemonID) {
        return self.callOrChain({
            type: RequestType.START_GYM_BATTLE,
            message: new RequestMessages.StartGymBattleMessage({
                gym_id: gymID,
                attacking_pokemon_ids: attackingPokemonIDs,
                defending_pokemon_id: defendingPokemonID,
                player_latitude: self.playerLatitude,
                player_longitude: self.playerLongitude
            }),
            responseType: Responses.StartGymBattleResponse
        });
    };

    this.attackGym = function(gymID, battleID, attackActions, lastRetrievedAction) {
        return self.callOrChain({
            type: RequestType.ATTACK_GYM,
            message: new RequestMessages.AttackGymMessage({
                gym_id: gymID,
                battle_id: battleID,
                attack_actions: attackActions,
                last_retrieved_actions: lastRetrievedAction,
                player_latitude: self.playerLatitude,
                player_longitude: self.playerLongitude
            }),
            responseType: Responses.AttackGymResponse
        });
    };

    this.recycleInventoryItem = function(itemID, count) {
        return self.callOrChain({
            type: RequestType.RECYCLE_INVENTORY_ITEM,
            message: new RequestMessages.RecycleInventoryItemMessage({
                item_id: itemID,
                count: count
            }),
            responseType: Responses.RecycleInventoryItemResponse
        });
    };

    this.collectDailyBonus = function() {
        return self.callOrChain({
            type: RequestType.COLLECT_DAILY_BONUS,
            responseType: Responses.CollectDailyBonusResponse
        });
    };

    this.useItemXPBoost = function(itemID) {
        return self.callOrChain({
            type: RequestType.USE_ITEM_XP_BOOST,
            message: new RequestMessages.UseItemXpBoostMessage({
                item_id: itemID
            }),
            responseType: Responses.UseItemXpBoostResponse
        });
    };

    this.useItemEggIncubator = function(itemID, pokemonID) {
        return self.callOrChain({
            type: RequestType.USE_ITEM_EGG_INCUBATOR,
            message: new RequestMessages.UseItemEggIncubatorMessage({
                item_id: itemID,
                pokemon_id: pokemonID
            }),
            responseType: Responses.UseItemEggIncubatorResponse
        });
    };

    this.useIncense = function(itemID) {
        return self.callOrChain({
            type: RequestType.USE_INCENSE,
            message: new RequestMessages.UseIncenseMessage({
                incense_type: itemID
            }),
            responseType: Responses.UseIncenseResponse
        });
    };

    this.getIncensePokemon = function() {
        return self.callOrChain({
            type: RequestType.GET_INCENSE_POKEMON,
            message: new RequestMessages.GetIncensePokemonMessage({
                player_latitude: self.playerLatitude,
                player_longitude: self.playerLongitude
            }),
            responseType: Responses.GetIncensePokmeonResponse
        });
    };

    this.incenseEncounter = function(encounterID, encounterLocation) {
        return self.callOrChain({
            type: RequestType.INCENSE_ENCOUNTER,
            message: new RequestMessages.IncenseEncounterMessage({
                encounter_id: encounterID,
                encounter_location: encounterLocation
            }),
            responseType: Responses.IncenseEncounterResponse
        });
    };

    this.addFortModifier = function(modifierItemID, fortID) {
        return self.callOrChain({
            type: RequestType.ADD_FORT_MODIFIER,
            message: new RequestMessages.AddFortModifierMessage({
                modifier_type: modifierItemID,
                fort_id: fortID,
                player_latitude: self.playerLatitude,
                player_longitude: self.playerLongitude
            })
        });
    };

    this.diskEncounter = function(encounterID, fortID) {
        return self.callOrChain({
            type: RequestType.DISK_ENCOUNTER,
            message: new RequestMessages.DiskEncounterMessage({
                encounter_id: encounterID,
                fort_id: fortID,
                player_latitude: self.playerLatitude,
                player_longitude: self.playerLongitude
            }),
            responseType: Responses.DiskEncounterResponse
        });
    };

    this.collectDailyDefenderBonus = function() {
        return self.callOrChain({
            type: RequestType.COLLECT_DAILY_DEFENDER_BONUS,
            responseType: Responses.CollectDailyDefenderBonusResponse
        });
    };

    this.upgradePokemon = function(pokemonID) {
        return self.callOrChain({
            type: RequestType.UPGRADE_POKEMON,
            message: new RequestMessages.UpgradePokemonMessage({
                pokemon_id: pokemonID
            }),
            responseType: Responses.UpgradePokemonResponse
        });
    };

    this.setFavoritePokemon = function(pokemonID, isFavorite) {
        return self.callOrChain({
            type: RequestType.SET_FAVORITE_POKEMON,
            message: new RequestMessages.SetFavoritePokemonMessage({
                pokemon_id: pokemonID,
                is_favorite: isFavorite
            }),
            responseType: Responses.SetFavoritePokemonResponse
        });
    };

    this.nicknamePokemon = function(pokemonID, nickname) {
        return self.callOrChain({
            type: RequestType.NICKNAME_POKEMON,
            message: new RequestMessages.NicknamePokemonMessage({
                pokemon_id: pokemonID,
                nickname: nickname
            }),
            responseType: Responses.NicknamePokemonResponse
        });
    };

    this.equipBadge = function(badgeType) {
        return self.callOrChain({
            type: RequestType.EQUIP_BADGE,
            message: new RequestMessages.EquipBadgeMessage({
                badge_type: badgeType
            }),
            responseType: Responses.EquipBadgeResponse
        });
    };

    this.setContactSettings = function(sendMarketingEmails, sendPushNotifications) {
        return self.callOrChain({
            type: RequestType.SET_CONTACT_SETTINGS,
            message: new RequestMessages.SetContactSettingsMessage({
                contact_settings: {
                    send_marketing_emails: sendMarketingEmails,
                    send_push_notifications: sendPushNotifications
                }
            }),
            responseType: Responses.SetContactSettingsResponse
        });
    };

    this.getAssetDigest = function(platform, deviceManufacturer, deviceModel, locale, appVersion) {
        return self.callOrChain({
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
    };

    this.getDownloadURLs = function(assetIDs) {
        return self.callOrChain({
            type: RequestType.GET_DOWNLOAD_URLS,
            message: new RequestMessages.GetDownloadUrlsMessage({
                asset_id: assetIDs
            }),
            responseType: Responses.GetDownloadUrlsResponse
        });
    };

    this.getSuggestedCodenames = function() {
        return self.callOrChain({
            type: RequestType.GET_SUGGESTED_CODENAMES,
            responseType: Responses.GetSuggestedCodenamesResponse
        });
    };

    this.checkCodenameAvailable = function(codename) {
        return self.callOrChain({
            type: RequestType.CHECK_CODENAME_AVAILABLE,
            message: new RequestMessages.CheckCodenameAvailableMessage({
                codename: codename
            }),
            responseType: Responses.CheckCodenameAvailableResponse
        });
    };

    this.claimCodename = function(codename) {
        return self.callOrChain({
            type: RequestType.CLAIM_CODENAME,
            message: new RequestMessages.ClaimCodenameMessage({
                codename: codename
            }),
            responseType: Responses.ClaimCodenameResponse
        });
    };

    this.setAvatar = function(skin, hair, shirt, pants, hat, shoes, gender, eyes, backpack) {
        return self.callOrChain({
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
    };

    this.setPlayerTeam = function(teamColor) {
        return self.callOrChain({
            type: RequestType.SET_PLAYER_TEAM,
            message: new RequestMessages.SetPlayerTeamMessage({
                team: teamColor
            }),
            responseType: Responses.SetPlayerTeamResponse
        });
    };

    this.markTutorialComplete = function(tutorialsCompleted, sendMarketingEmails, sendPushNotifications) {
        return self.callOrChain({
            type: RequestType.MARK_TUTORIAL_COMPLETE,
            message: new RequestMessages.MarkTutorialCompleteMessage({
                tutorials_completed: tutorialsCompleted,
                send_marketing_emails: sendMarketingEmails,
                send_push_notifications: sendPushNotifications
            }),
            responseType: Responses.MarkTutorialCompleteResponse
        });
    };

    this.echo = function() {
        return self.callOrChain({
            type: RequestType.ECHO,
            responseType: Responses.EchoResponse
        });
    };

    this.sfidaActionLog = function() {
        return self.callOrChain({
            type: RequestType.SFIDA_ACTION_LOG,
            responseType: Responses.SfidaActionLogResponse
        });
    };

    /*
     * INTERNAL STUFF
     */

    this.request = request.defaults({
        headers: {
            'User-Agent': 'Niantic App',
            'Accept': '*/*',
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        encoding: null
    });

    this.maxTries = 5;
    this.mapObjectsThrottlingEnabled = true;
    this.mapObjectsMinDelay = DEFAULT_MAP_OBJECTS_DELAY * 1000;

    /**
     * Executes a request and returns a Promise or, if we are in batch mode, adds it to the
     * list of batched requests and returns this (for chaining).
     * @private
     * @param {object} requestMessage - RPC request object
     * @return {Promise|Client}
     */
    this.callOrChain = function(requestMessage) {
        if (self.batchRequests) {
            self.batchRequests.push(requestMessage);
            return self;
        } else {
            return self.callRPC([requestMessage]);
        }
    };

    /**
     * Generates a random request ID
     * @private
     * @return {Long}
     */
    this.getRequestID = function() {
        var bytes = crypto.randomBytes(8);
        return Long.fromBits(
            bytes[0] << 24 | bytes[1] << 16 | bytes[2] << 8 | bytes[3],
            bytes[4] << 24 | bytes[5] << 16 | bytes[6] << 8 | bytes[7],
            true
        );
    };

    /**
     * Creates an RPC envelope with the given list of requests.
     * @private
     * @param {Object[]} requests - Array of requests to build
     * @return {POGOProtos.Networking.Envelopes.RequestEnvelope}
     */
    this.buildEnvelope = function(requests) {
        var envelopeData = {
            status_code: 2,
            request_id: self.getRequestID(),
            unknown12: 989
        };

        if (self.playerLatitude) envelopeData.latitude = self.playerLatitude;
        if (self.playerLongitude) envelopeData.longitude = self.playerLongitude;
        if (self.playerAltitude) envelopeData.altitude = self.playerAltitude;

        if (self.authTicket) {
            envelopeData.auth_ticket = self.authTicket;
        } else if (!self.authType || !self.authToken) {
            throw Error('No auth info provided');
        } else {
            envelopeData.auth_info = {
                provider: self.authType,
                token: {
                    contents: self.authToken,
                    unknown2: 59
                }
            };
        }

        if (requests) {
            self.emit('request', {
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

        self.emit('raw-request', envelopeData);

        return new POGOProtos.Networking.Envelopes.RequestEnvelope(envelopeData);
    };

    /**
     * Creates an RPC envelope with the given list of requests and adds the encrypted signature,
     * or adds the signature to an existing envelope.
     * @private
     * @param {Object[]} requests - Array of requests to build
     * @param {RequestEnvelope} [envelope] - Pre-built request envelope to sign
     * @return {Promise} - A Promise that will be resolved with a RequestEnvelope instance
     */
    this.buildSignedEnvelope = function(requests, envelope) {
        return new Promise((resolve, reject) => {
            if (!envelope) {
                try {
                    envelope = self.buildEnvelope(requests);
                } catch (e) {
                    reject(new retry.StopError(e));
                }
            }

            if (!envelope.auth_ticket) {
                // Can't sign before we have received an auth ticket
                resolve(envelope);
                return;
            }

            self.signatureBuilder.setAuthTicket(envelope.auth_ticket);
            self.signatureBuilder.setLocation(envelope.latitude, envelope.longitude, envelope.altitude);

            self.signatureBuilder.encrypt(envelope.requests, (err, sigEncrypted) => {
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
    };

    /**
     * Executes an RPC call with the given list of requests, retrying if necessary.
     * @private
     * @param {Object[]} requests - Array of requests to send
     * @param {RequestEnvelope} [envelope] - Pre-built request envelope to use
     * @return {Promise} - A Promise that will be resolved with the (list of) response messages,
     *     or true if there aren't any
     */
    this.callRPC = function(requests, envelope) {
        // If the requests include a map objects request, make sure the minimum delay
        // since the last call has passed
        if (requests.some(r => r.type === RequestType.GET_MAP_OBJECTS)) {
            var now = new Date().getTime(),
                delayNeeded = self.lastMapObjectsCall + self.mapObjectsMinDelay - now;

            if (delayNeeded > 0 && self.mapObjectsThrottlingEnabled) {
                return Promise.delay(delayNeeded).then(() => self.callRPC(requests, envelope));
            }

            self.lastMapObjectsCall = now;
        }

        if (self.maxTries <= 1) return self.tryCallRPC(requests, envelope);

        return retry(() => self.tryCallRPC(requests, envelope), {
            interval: 300,
            backoff: 2,
            max_tries: self.maxTries
        });
    };

    /**
     * Executes an RPC call with the given list of requests.
     * @private
     * @param {Object[]} requests - Array of requests to send
     * @param {RequestEnvelope} [envelope] - Pre-built request envelope to use
     * @return {Promise} - A Promise that will be resolved with the (list of) response messages,
     *     or true if there aren't any
     */
    this.tryCallRPC = function(requests, envelope) {
        return self.buildSignedEnvelope(requests, envelope)
            .then(signedEnvelope => new Promise((resolve, reject) => {
                self.request({
                    method: 'POST',
                    url: self.endpoint,
                    proxy: self.proxy,
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
                        self.emit('parse-envelope-error', body, e);
                        if (e.decoded) {
                            responseEnvelope = e.decoded;
                        } else {
                            reject(new retry.StopError(e));
                            return;
                        }
                    }

                    self.emit('raw-response', responseEnvelope);

                    if (responseEnvelope.error) {
                        reject(new retry.StopError(responseEnvelope.error));
                        return;
                    }

                    if (responseEnvelope.auth_ticket) self.authTicket = responseEnvelope.auth_ticket;

                    if (self.endpoint === INITIAL_ENDPOINT) {
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

                        self.endpoint = 'https://' + responseEnvelope.api_url + '/rpc';

                        self.emit('endpoint-response', {
                            status_code: responseEnvelope.status_code,
                            request_id: responseEnvelope.request_id.toString(),
                            api_url: responseEnvelope.api_url
                        });

                        resolve(self.callRPC(requests, envelope));
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
                                self.emit('parse-response-error', responseEnvelope.returns[i].toBuffer(), e);
                                reject(new retry.StopError(e));
                                return;
                            }

                            responses.push(responseMessage);
                        }
                    }

                    self.emit('response', {
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
    };

    /**
     * Processes the data received from the initial API call during init().
     * @private
     * @param {Object[]} responses - Respones from API call
     * @return {Object[]} respones - Unomdified responses (to send back to Promise)
     */
    this.processInitialData = function(responses) {
        // Extract the minimum delay of getMapObjects()
        if (responses.length >= 5) {
            var settingsResponse = responses[4];
            if (!settingsResponse.error &&
                settingsResponse.settings &&
                settingsResponse.settings.map_settings &&
                settingsResponse.settings.map_settings.get_map_objects_min_refresh_seconds
            ) {
                self.mapObjectsMinDelay =
                    settingsResponse.settings.map_settings.get_map_objects_min_refresh_seconds * 1000;
            }
        }
        return responses;
    };
}

Client.prototype = Object.create(EventEmitter.prototype);

module.exports = Client;