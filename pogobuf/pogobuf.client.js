'use strict';

const EventEmitter = require('events').EventEmitter,
    Long = require('long'),
    POGOProtos = require('node-pogo-protos'),
    pogoSignature = require('node-pogo-signature'),
    Promise = require('bluebird'),
    request = require('request'),
    retry = require('bluebird-retry'),
    Utils = require('./pogobuf.utils.js'),
    PTCLogin = require('./pogobuf.ptclogin.js'),
    GoogleLogin = require('./pogobuf.googlelogin.js'),
    Signature = require('./pogobuf.signature');

const Lehmer = Utils.Random;

Promise.promisifyAll(request);

const RequestType = POGOProtos.Networking.Requests.RequestType,
    PlatformRequestType = POGOProtos.Networking.Platform.PlatformRequestType,
    PlatformRequestMessages = POGOProtos.Networking.Platform.Requests,
    PlatformResponses = POGOProtos.Networking.Platform.Responses,
    RequestMessages = POGOProtos.Networking.Requests.Messages,
    Responses = POGOProtos.Networking.Responses;

const INITIAL_ENDPOINT = 'https://pgorelease.nianticlabs.com/plfe/rpc';
const INITIAL_PTR8 = '90f6a704505bccac73cec99b07794993e6fd5a12';

// See pogobuf wiki for description of options
const defaultOptions = {
    authType: 'ptc',
    authToken: null,
    username: null,
    password: null,
    downloadSettings: true,
    mapObjectsThrottling: true,
    mapObjectsMinDelay: 5000,
    proxy: null,
    maxTries: 5,
    automaticLongConversion: true,
    includeRequestTypeInResponse: false,
    version: 4500,
    signatureInfo: null,
    useHashingServer: false,
    hashingServer: 'http://hashing.pogodev.io/',
    hashingKey: null,
    deviceId: null,
};

/**
 * Pokémon Go RPC client.
 * @class Client
 * @param {Object} [options] - Client options (see pogobuf wiki for documentation)
 * @memberof pogobuf
 */
function Client(options) {
    if (!(this instanceof Client)) {
        return new Client(options);
    }
    const self = this;

    /*
     * PUBLIC METHODS
     */

     /**
      * Sets the specified client option to the given value.
      * Note that not all options support changes after client initialization.
      * @param {string} option - Option name
      * @param {any} value - Option value
      */
    this.setOption = function(option, value) {
        self.options[option] = value;
    };

    /**
     * Sets the player's latitude and longitude.
     * Note that this does not actually update the player location on the server, it only sets
     * the location to be used in following API calls. To update the location on the server you
     * need to make an API call.
     * @param {number|object} latitude - The player's latitude, or an object with parameters
     * @param {number} longitude - The player's longitude
     * @param {number} [accuracy=0] - The location accuracy in m
     * @param {number} [altitude=0] - The player's altitude
     */
    this.setPosition = function(latitude, longitude, accuracy, altitude) {
        if (typeof latitude === 'object') {
            const pos = latitude;
            latitude = pos.latitude;
            longitude = pos.longitude;
            accuracy = pos.accuracy;
            altitude = pos.altitude;
        }
        self.playerLatitude = latitude;
        self.playerLongitude = longitude;
        self.playerLocationAccuracy = accuracy || 0;
        self.playerAltitude = altitude || 0;
    };

    /**
     * Performs client initialization and downloads needed settings from the API and hashing server.
     * @param {boolean} [downloadSettings] - Deprecated, use downloadSettings option instead
     * @return {Promise} promise
     */
    this.init = function(downloadSettings) {
        // For backwards compatibility only
        if (typeof downloadSettings !== 'undefined') self.setOption('downloadSettings', downloadSettings);

        self.lastMapObjectsCall = 0;

        // if no signature is defined, use default signature module
        if (!self.options.signatureInfo) {
            Signature.register(self, self.options.deviceId);
        }

        // convert app version (5100) to client version (0.51)
        let signatureVersion = '0.' + ((+self.options.version) / 100).toFixed(0);
        if ((+self.options.version % 100) !== 0) {
            signatureVersion += '.' + (+self.options.version % 100);
        }

        self.signatureBuilder = new pogoSignature.Builder({
            protos: POGOProtos,
            version: signatureVersion,
        });
        self.signatureBuilder.encryptAsync = Promise.promisify(self.signatureBuilder.encrypt,
                                                                { context: self.signatureBuilder });

        /*
            The response to the first RPC call does not contain any response messages even though
            the envelope includes requests, technically it wouldn't be necessary to send the
            requests but the app does the same. The call will then automatically be resent to the
            new API endpoint by callRPC().
        */
        self.endpoint = INITIAL_ENDPOINT;

        let promise = Promise.resolve(true);

        // login
        if (!self.options.token) {
            if (!self.options.username) throw new Error('No token nor credentials provided.');
            if (self.options.authType == 'ptc') {
                self.login = new PTCLogin();
                if (self.options.proxy) self.login.setProxy(self.options.proxy);
            } else {
                self.login = new GoogleLogin();
            }

            promise = promise.then(() => {
                return self.login.login(self.options.username, self.options.password)
                        .then(token => {
                            self.options.authToken = token;
                        });
            });
        }

        if (self.options.useHashingServer) {
            promise = promise.then(self.initializeHashingServer);
        }

        if (self.options.downloadSettings) {
            promise = promise.then(() => self.downloadSettings()).then(self.processSettingsResponse);
        }

        return promise;
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
        var p = self.callRPC(self.batchRequests || []);
        self.batchClear();
        return p;
    };

    /**
     * Gets rate limit info from the latest signature server request, if applicable.
     * @return {Object}
     */
    this.getSignatureRateInfo = function() {
        return self.signatureBuilder.rateInfos;
    };

    /*
     * API CALLS (in order of RequestType enum)
     */

    this.getPlayer = function(country, language, timezone) {
        return self.callOrChain({
            type: RequestType.GET_PLAYER,
            message: new RequestMessages.GetPlayerMessage({
                player_locale: {
                    country: country,
                    language: language,
                    timezone: timezone
                }
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

    this.downloadItemTemplates = function(paginate, pageOffset, pageTimestamp) {
        return self.callOrChain({
            type: RequestType.DOWNLOAD_ITEM_TEMPLATES,
            message: new RequestMessages.DownloadItemTemplatesMessage({
                paginate: paginate,
                page_offset: pageOffset,
                page_timestamp: pageTimestamp
            }),
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

    this.registerBackgroundDevice = function(deviceType, deviceID) {
        return self.callOrChain({
            type: RequestType.REGISTER_BACKGROUND_DEVICE,
            message: new RequestMessages.RegisterBackgroundDeviceMessage({
                device_type: deviceType,
                device_id: deviceID
            }),
            responseType: Responses.RegisterBackgroundDeviceResponse
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

    this.releasePokemon = function(pokemonIDs) {
        if (!Array.isArray(pokemonIDs)) pokemonIDs = [pokemonIDs];

        return self.callOrChain({
            type: RequestType.RELEASE_POKEMON,
            message: new RequestMessages.ReleasePokemonMessage({
                pokemon_id: pokemonIDs.length === 1 ? pokemonIDs[0] : undefined,
                pokemon_ids: pokemonIDs.length > 1 ? pokemonIDs : undefined
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

    this.evolvePokemon = function(pokemonID, evolutionRequirementItemID) {
        return self.callOrChain({
            type: RequestType.EVOLVE_POKEMON,
            message: new RequestMessages.EvolvePokemonMessage({
                pokemon_id: pokemonID,
                evolution_item_requirement: evolutionRequirementItemID
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

    this.getGymDetails = function(gymID, gymLatitude, gymLongitude, clientVersion) {
        return self.callOrChain({
            type: RequestType.GET_GYM_DETAILS,
            message: new RequestMessages.GetGymDetailsMessage({
                gym_id: gymID,
                player_latitude: self.playerLatitude,
                player_longitude: self.playerLongitude,
                gym_latitude: gymLatitude,
                gym_longitude: gymLongitude,
                client_version: clientVersion
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
                last_retrieved_action: lastRetrievedAction,
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

    this.setBuddyPokemon = function(pokemonID) {
        return self.callOrChain({
            type: RequestType.SET_BUDDY_POKEMON,
            message: new RequestMessages.SetBuddyPokemonMessage({
                pokemon_id: pokemonID
            }),
            responseType: Responses.SetBuddyPokemonResponse
        });
    };

    this.getBuddyWalked = function() {
        return self.callOrChain({
            type: RequestType.GET_BUDDY_WALKED,
            responseType: Responses.GetBuddyWalkedResponse
        });
    };

    this.useItemEncounter = function(itemID, encounterID, spawnPointGUID) {
        return self.callOrChain({
            type: RequestType.USE_ITEM_ENCOUNTER,
            message: new RequestMessages.UseItemEncounterMessage({
                item: itemID,
                encounter_id: encounterID,
                spawn_point_guid: spawnPointGUID
            }),
            responseType: Responses.UseItemEncounterResponse
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

    this.claimCodename = function(codename) {
        return self.callOrChain({
            type: RequestType.CLAIM_CODENAME,
            message: new RequestMessages.ClaimCodenameMessage({
                codename: codename
            }),
            responseType: Responses.ClaimCodenameResponse
        });
    };

    this.setAvatar = function(skin, hair, shirt, pants, hat, shoes, avatar, eyes, backpack) {
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
                    avatar: avatar,
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

    this.checkChallenge = function(isDebugRequest) {
        return self.callOrChain({
            type: RequestType.CHECK_CHALLENGE,
            message: new RequestMessages.CheckChallengeMessage({
                debug_request: isDebugRequest
            }),
            responseType: Responses.CheckChallengeResponse
        });
    };

    this.verifyChallenge = function(token) {
        return self.callOrChain({
            type: RequestType.VERIFY_CHALLENGE,
            message: new RequestMessages.VerifyChallengeMessage({
                token: token
            }),
            responseType: Responses.VerifyChallengeResponse
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

    this.listAvatarCustomizations = function(avatarType, slots, filters, start, limit) {
        return self.callOrChain({
            type: RequestType.LIST_AVATAR_CUSTOMIZATIONS,
            message: new RequestMessages.ListAvatarCustomizationsMessage({
                avatar_type: avatarType,
                slot: slots,
                filters: filters,
                start: start,
                limit: limit
            }),
            responseType: Responses.ListAvatarCustomizationsResponse
        });
    };

    this.setAvatarItemAsViewed = function(avatarTemplateIDs) {
        return self.callOrChain({
            type: RequestType.SET_AVATAR_ITEM_AS_VIEWED,
            message: new RequestMessages.SetAvatarItemAsViewedMessage({
                avatar_template_id: avatarTemplateIDs
            }),
            responseType: Responses.SetAvatarItemAsViewdResponse
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

    this.options = Object.assign({}, defaultOptions, options || {});
    this.authTicket = null;
    this.rpcId = 2;
    this.lastHashingKeyIndex = 0;
    this.firstGetMapObjects = true;
    this.lehmer = new Lehmer(16807);
    this.ptr8 = INITIAL_PTR8;

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
     * Generates next rpc request id
     * @private
     * @return {Long}
     */
    this.getRequestID = function() {
        return new Long(self.rpcId++, this.lehmer.nextInt());
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
            ms_since_last_locationfix: 100 + Math.floor(Math.random() * 900)
        };

        if (self.playerLatitude) envelopeData.latitude = self.playerLatitude;
        if (self.playerLongitude) envelopeData.longitude = self.playerLongitude;
        if (self.playerLocationAccuracy) {
            envelopeData.accuracy = self.playerLocationAccuracy;
        } else {
            const values = [5, 5, 5, 5, 10, 10, 10, 30, 30, 50, 65];
            values.unshift(Math.floor(Math.random() * (80 - 66)) + 66);
            envelopeData.accuracy = values[Math.floor(values.length * Math.random())];
        }

        if (self.authTicket) {
            envelopeData.auth_ticket = self.authTicket;
        } else if (!self.options.authType || !self.options.authToken) {
            throw Error('No auth info provided');
        } else {
            let unknown2 = 0;
            if (self.options.authType === 'ptc') {
                const values = [2, 8, 21, 21, 21, 28, 37, 56, 59, 59, 59];
                unknown2 = values[Math.floor(values.length * Math.random())];
            }
            envelopeData.auth_info = {
                provider: self.options.authType,
                token: {
                    contents: self.options.authToken,
                    unknown2: unknown2,
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
     * Constructs and adds a platform request to a request envelope.
     * @private
     * @param {RequestEnvelope} envelope - Request envelope
     * @param {PlatformRequestType} requestType - Type of the platform request to add
     * @param {Object} requestMessage - Pre-built but not encoded PlatformRequest protobuf message
     * @return {RequestEnvelope} The envelope (for convenience only)
     */
    this.addPlatformRequestToEnvelope = function(envelope, requestType, requestMessage) {
        envelope.platform_requests.push(
            new POGOProtos.Networking.Envelopes.RequestEnvelope.PlatformRequest({
                type: requestType,
                request_message: requestMessage.encode()
            })
        );

        return envelope;
    };

    /**
     * Determines whether the as of yet unknown platform request type 8 should be added
     * to the envelope based on the given type of requests.
     * @private
     * @param {Object[]} requests - Array of request data
     * @return {boolean}
     */
    this.needsPtr8 = function(requests) {
        // Single GET_PLAYER request always gets PTR8
        if (requests.length === 1 && requests[0].type === RequestType.GET_PLAYER) {
            return true;
        }

        // Any GET_MAP_OBJECTS requests get PTR8 except the first one in the session
        if (requests.some(r => r.type === RequestType.GET_MAP_OBJECTS)) {
            if (self.firstGetMapObjects) {
                self.firstGetMapObjects = false;
                return false;
            }

            return true;
        }

        return false;
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
        if (!envelope) {
            try {
                envelope = self.buildEnvelope(requests);
            } catch (e) {
                throw new retry.StopError(e);
            }
        }

        if (self.needsPtr8(requests)) {
            self.addPlatformRequestToEnvelope(envelope, PlatformRequestType.UNKNOWN_PTR_8,
                new PlatformRequestMessages.UnknownPtr8Request({
                    message: self.ptr8,
                }));
        }

        let authTicket = envelope.auth_ticket;
        if (!authTicket) {
            authTicket = envelope.auth_info;
        }

        if (!authTicket) {
            // Can't sign before we have received an auth ticket
            return Promise.resolve(envelope);
        }

        if (self.options.useHashingServer) {
            let key = self.options.hashingKey;
            if (Array.isArray(key)) {
                key = key[self.lastHashingKeyIndex];
                self.lastHashingKeyIndex = (self.lastHashingKeyIndex + 1) % self.options.hashingKey.length;
            }

            self.signatureBuilder.useHashingServer(self.options.hashingServer + self.hashingVersion, key);
        }

        self.signatureBuilder.setAuthTicket(authTicket);
        self.signatureBuilder.setLocation(envelope.latitude, envelope.longitude, envelope.accuracy);

        if (typeof self.options.signatureInfo === 'function') {
            self.signatureBuilder.setFields(self.options.signatureInfo(envelope));
        } else if (self.options.signatureInfo) {
            self.signatureBuilder.setFields(self.options.signatureInfo);
        }

        return retry(() => self.signatureBuilder.encryptAsync(envelope.requests)
                        .catch(err => {
                            if (err.name === 'HashServerError' && err.message === 'Request limited') {
                                throw err;
                            } else {
                                throw new retry.StopError(err);
                            }
                        }),
            {
                interval: 1000,
                backoff: 2,
                max_tries: 10,
                args: envelope.requests,
            })
            .then(sigEncrypted =>
                self.addPlatformRequestToEnvelope(envelope, PlatformRequestType.SEND_ENCRYPTED_SIGNATURE,
                    new PlatformRequestMessages.SendEncryptedSignatureRequest({
                        encrypted_signature: sigEncrypted
                    })
                )
            );
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
                delayNeeded = self.lastMapObjectsCall + self.options.mapObjectsMinDelay - now;

            if (delayNeeded > 0 && self.options.mapObjectsThrottling) {
                return Promise.delay(delayNeeded).then(() => self.callRPC(requests, envelope));
            }

            self.lastMapObjectsCall = now;
        }

        if (self.options.maxTries <= 1) return self.tryCallRPC(requests, envelope);

        return retry(() => self.tryCallRPC(requests, envelope), {
            interval: 300,
            backoff: 2,
            max_tries: self.options.maxTries
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
                    proxy: self.options.proxy,
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
                                `Status code ${response.statusCode} received from HTTPS request`
                            ));
                        } else {
                            /* Anything else might be recoverable so throw regular Error */
                            reject(Error(
                                `Status code ${response.statusCode} received from HTTPS request`
                            ));
                        }
                        return;
                    }

                    var responseEnvelope;
                    try {
                        responseEnvelope =
                            POGOProtos.Networking.Envelopes.ResponseEnvelope.decode(body);
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

                        signedEnvelope.platform_requests = [];
                        resolve(self.callRPC(requests, signedEnvelope));
                        return;
                    }

                    responseEnvelope.platform_returns.forEach(platformReturn => {
                        if (platformReturn.type === PlatformRequestType.UNKNOWN_PTR_8) {
                            const ptr8 = PlatformResponses.UnknownPtr8Response.decode(platformReturn.response);
                            if (ptr8) self.ptr8 = ptr8.message;
                        }
                    });

                    /* Auth expire, auto relogin */
                    if (responseEnvelope.status_code === 102 && self.login) {
                        signedEnvelope.platform_requests = [];
                        self.login.reset();
                        self.login.login(self.options.username, self.options.password)
                        .then(token => {
                            self.options.authToken = token;
                            self.authTicket = null;
                            signedEnvelope.auth_ticket = null;
                            signedEnvelope.auth_info = token;
                            resolve(self.callRPC(requests, signedEnvelope));
                        });
                        return;
                    }

                    /* Throttling, retry same request later */
                    if (responseEnvelope.status_code === 52) {
                        signedEnvelope.platform_requests = [];
                        Promise.delay(2000).then(() => {
                            resolve(self.callRPC(requests, signedEnvelope));
                        });
                        return;
                    }

                    /* These codes indicate invalid input, no use in retrying so throw StopError */
                    if (responseEnvelope.status_code === 3 || responseEnvelope.status_code === 51 ||
                        responseEnvelope.status_code >= 100) {
                        reject(new retry.StopError(
                            `Status code ${responseEnvelope.status_code} received from RPC`
                        ));
                    }

                    /* These can be temporary so throw regular Error */
                    if (responseEnvelope.status_code !== 2 && responseEnvelope.status_code !== 1) {
                        reject(Error(
                            `Status code ${responseEnvelope.status_code} received from RPC`
                        ));
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
                                responseMessage = requests[i].responseType.decode(
                                    responseEnvelope.returns[i]
                                );
                            } catch (e) {
                                self.emit('parse-response-error',
                                    responseEnvelope.returns[i].toBuffer(), e);
                                reject(new retry.StopError(e));
                                return;
                            }

                            if (self.options.includeRequestTypeInResponse) {
                                // eslint-disable-next-line no-underscore-dangle
                                responseMessage._requestType = requests[i].type;
                            }
                            responses.push(responseMessage);
                        }
                    }

                    self.emit('response', {
                        status_code: responseEnvelope.status_code,
                        request_id: responseEnvelope.request_id.toString(),
                        responses: responses.map((r, h) => ({
                            name: Utils.getEnumKeyByValue(
                                RequestType, requests[h].type
                            ),
                            type: requests[h].type,
                            data: r
                        }))
                    });

                    if (self.options.automaticLongConversion) {
                        responses = Utils.convertLongs(responses);
                    }

                    if (!responses.length) resolve(true);
                    else if (responses.length === 1) resolve(responses[0]);
                    else resolve(responses);
                });
            }));
    };

    /**
     * Processes the data received from the downloadSettings API call during init().
     * @private
     * @param {Object} settingsResponse - Response from API call
     * @return {Object} response - Unomdified response (to send back to Promise)
     */
    this.processSettingsResponse = function(settingsResponse) {
        // Extract the minimum delay of getMapObjects()
        if (settingsResponse &&
            !settingsResponse.error &&
            settingsResponse.settings &&
            settingsResponse.settings.map_settings &&
            settingsResponse.settings.map_settings.get_map_objects_min_refresh_seconds
        ) {
            self.setOption('mapObjectsMinDelay',
                settingsResponse.settings.map_settings.get_map_objects_min_refresh_seconds * 1000);
        }
        return settingsResponse;
    };

    /**
     * Makes an initial call to the hashing server to verify API version.
     * @private
     * @return {Promise}
     */
    this.initializeHashingServer = function() {
        if (!self.options.hashingServer) throw new Error('Hashing server enabled without host');
        if (!self.options.hashingKey) throw new Error('Hashing server enabled without key');

        if (self.options.hashingServer.slice(-1) !== '/') {
            self.setOption('hashingServer', self.options.hashingServer + '/');
        }

        return request.getAsync(self.options.hashingServer + 'api/hash/versions').then(response => {
            const versions = JSON.parse(response.body);
            if (!versions) throw new Error('Invalid initial response from hashing server');

            let iosVersion = '1.' + ((+self.options.version - 3000) / 100).toFixed(0);
            iosVersion += '.' + (+self.options.version % 100);

            self.hashingVersion = versions[iosVersion];

            if (!self.hashingVersion) {
                throw new Error('Unsupported version for hashserver: ' + self.options.version + '/' + iosVersion);
            }

            return true;
        });
    };

    /*
     * DEPRECATED METHODS
     */

    /**
     * Sets the authType and authToken options.
     * @deprecated Use options object or setOption() instead
     * @param {string} authType
     * @param {string} authToken
     */
    this.setAuthInfo = function(authType, authToken) {
        self.setOption('authType', authType);
        self.setOption('authToken', authToken);
    };

    /**
     * Sets the includeRequestTypeInResponse option.
     * @deprecated Use options object or setOption() instead
     * @param {bool} includeRequestTypeInResponse
     */
    this.setIncludeRequestTypeInResponse = function(includeRequestTypeInResponse) {
        self.setOption('includeRequestTypeInResponse', includeRequestTypeInResponse);
    };

    /**
     * Sets the maxTries option.
     * @deprecated Use options object or setOption() instead
     * @param {integer} maxTries
     */
    this.setMaxTries = function(maxTries) {
        self.setOption('maxTries', maxTries);
    };

    /**
     * Sets the proxy option.
     * @deprecated Use options object or setOption() instead
     * @param {string} proxy
     */
    this.setProxy = function(proxy) {
        self.setOption('proxy', proxy);
    };

    /**
     * Sets the mapObjectsThrottling option.
     * @deprecated Use options object or setOption() instead
     * @param {boolean} enable
     */
    this.setMapObjectsThrottlingEnabled = function(enable) {
        self.setOption('mapObjectsThrottling', enable);
    };

    /**
     * Sets the signatureInfo option.
     * @deprecated Use options object or setOption() instead
     * @param {object|function} info
     */
    this.setSignatureInfo = function(info) {
        self.setOption('signatureInfo', info);
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

    /**
     * Sets the automaticLongConversion option.
     * @deprecated Use options object or setOption() instead
     * @param {boolean} enable
     */
    this.setAutomaticLongConversionEnabled = function(enable) {
        if (typeof enable !== 'boolean') return;
        self.setOption('automaticLongConversion', enable);
    };
}

Client.prototype = Object.create(EventEmitter.prototype);

module.exports = Client;
