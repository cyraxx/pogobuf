'use strict';

const
    POGOProtos = require('node-pogo-protos');

const
    RequestType = POGOProtos.Networking.Requests.RequestType,
    RequestMessages = POGOProtos.Networking.Requests.Messages,
    Responses = POGOProtos.Networking.Responses;

module.exports = {
    /**
     * playerUpdate: Update current player position to server
     * @param {number} latitude
     * @param {number} longitude
     * @returns {object} POGO request object
     */
    playerUpdate() {
        return {
            type: RequestType.PLAYER_UPDATE,
            message: new RequestMessages.PlayerUpdateMessage({
                latitude: this.playerLatitude,
                longitude: this.playerLongitude
            }),
            responseType: Responses.PlayerUpdateResponse
        };
    },

    /**
     * getPlayer: get player data
     * @param {string} appVersion - current app version eg. "0.31.1"
     * @returns {object} POGO request object
     */
    getPlayer(appVersion) {
        return {
            type: RequestType.GET_PLAYER,
            message: new RequestMessages.GetPlayerMessage({
                app_version: appVersion
            }),
            responseType: Responses.GetPlayerResponse
        };
    },


    /**
    * getInventory: get the players inventory: bag, pokemon, eggs, pokedex,
    * upgrades, used items, currency and candies.
    * Util method `pogobuf.Utils.splitInventory` can be used on the result
    * @param {number} lastTimestamp - unknown, the app seems to always give 0
    * @returns {object} POGO request object
    */
    getInventory(lastTimestamp) {
        return {
            type: RequestType.GET_INVENTORY,
            message: new RequestMessages.GetInventoryMessage({
                last_timestamp_ms: lastTimestamp
            }),
            responseType: Responses.GetInventoryResponse
        };
    },

   /**
    * downloadSettings: download the current app settings
    * @param {string} hash
    * @returns {object} POGO request object
    */
    downloadSettings(hash) {
        return {
            type: RequestType.DOWNLOAD_SETTINGS,
            message: new RequestMessages.DownloadSettingsMessage({
                hash: hash
            }),
            responseType: Responses.DownloadSettingsResponse
        };
    },

   /**
    * downloadItemTemplates
    * @returns {object} POGO request object
    */
    downloadItemTemplates() {
        return {
            type: RequestType.DOWNLOAD_ITEM_TEMPLATES,
            responseType: Responses.DownloadItemTemplatesResponse
        };
    },

   /**
    * downloadRemoteConfigVersion
    * @param {string} platform
    * @param {string} deviceManufacturer
    * @param {string} deviceModel
    * @param {string} locale
    * @param {string} appVersion
    * @returns {object} POGO request object
    */
    downloadRemoteConfigVersion(platform, deviceManufacturer, deviceModel, locale, appVersion) {
        return {
            type: RequestType.DOWNLOAD_REMOTE_CONFIG_VERSION,
            message: new RequestMessages.DownloadRemoteConfigVersionMessage({
                platform: platform,
                device_manufacturer: deviceManufacturer,
                device_model: deviceModel,
                locale: locale,
                app_version: appVersion
            }),
            responseType: Responses.DownloadRemoteConfigVersionResponse
        };
    },

   /**
    * fortSearch: Spin a fort for rewards, does not work on gyms
    * @param {string} fortID
    * @param {string} fortLatitude
    * @param {string} fortLongitude
    * @returns {object} POGO request object
    */
    fortSearch(fortID, fortLatitude, fortLongitude) {
        return {
            type: RequestType.FORT_SEARCH,
            message: new RequestMessages.FortSearchMessage({
                fort_id: fortID,
                player_latitude: this.playerLatitude,
                player_longitude: this.playerLongitude,
                fort_latitude: fortLatitude,
                fort_longitude: fortLongitude
            }),
            responseType: Responses.FortSearchResponse
        };
    },

   /**
    * encounter: Start a enncounter with specified nearby pokemon
    * @param {string} encounterID
    * @param {string} spawnPointID
    * @returns {object} POGO request object
    */
    encounter(encounterID, spawnPointID) {
        return {
            type: RequestType.ENCOUNTER,
            message: new RequestMessages.EncounterMessage({
                encounter_id: encounterID,
                spawn_point_id: spawnPointID,
                player_latitude: this.playerLatitude,
                player_longitude: this.playerLongitude
            }),
            responseType: Responses.EncounterResponse
        };
    },

   /**
    * catchPokemon: throw a pokeball during a encounter
    * @param {number} encounterID - encounter_id from the encounter
    * @param {number} pokeballItemID - Which pokeball 1 = normal, 2 = great, 3 = ultra
    * @param {string} normalizedReticleSize - Current size of the circle. eg. 1.950 for very small
    * @param {number} spawnPointID - spawn_point_id from the encounter
    * @param {bool} hitPokemon - Did the pokeball hit the pokemon
    * @param {string} spinModifier - Curve ratio, eg. curve bonus: 0.850
    * @param {string} normalizedHitPosition - Where the pokeball hit the pokemon. 1.0 is center
    * @returns {object} POGO request object
    */
    catchPokemon(encounterID, pokeballItemID, normalizedReticleSize, spawnPointID, hitPokemon,
       spinModifier, normalizedHitPosition) {
        return {
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
        };
    },

   /**
    * fortDetails: look up fort details
    * @param {number} fortID
    * @param {number} fortLatitude
    * @param {number} fortLongitude
    * @returns {object} POGO request object
    */
    fortDetails(fortID, fortLatitude, fortLongitude) {
        return {
            type: RequestType.FORT_DETAILS,
            message: new RequestMessages.FortDetailsMessage({
                fort_id: fortID,
                latitude: fortLatitude,
                longitude: fortLongitude
            }),
            responseType: Responses.FortDetailsResponse
        };
    },

   /**
    * getMapObjects: Load map data like forts and pokemon
    * @param {array} cellIDs - S2 geo cell IDs of which you want map data
    * @param {array} sinceTimestamps - Array of timestamps with same length of cellIDs
    * @returns {object} POGO request object
    */
    getMapObjects(cellIDs, sinceTimestamps) {
        return {
            type: RequestType.GET_MAP_OBJECTS,
            message: new RequestMessages.GetMapObjectsMessage({
                cell_id: cellIDs,
                since_timestamp_ms: sinceTimestamps,
                latitude: this.playerLatitude,
                longitude: this.playerLongitude
            }),
            responseType: Responses.GetMapObjectsResponse
        };
    },

   /**
    * fortDeployPokemon
    * @param {number} fortID
    * @param {number} pokemonID
    * @returns {object} POGO request object
    */
    fortDeployPokemon(fortID, pokemonID) {
        return {
            type: RequestType.FORT_DEPLOY_POKEMON,
            message: new RequestMessages.FortDeployPokemonMessage({
                fort_id: fortID,
                pokemon_id: pokemonID,
                player_latitude: this.playerLatitude,
                player_longitude: this.playerLongitude
            }),
            responseType: Responses.FortDeployPokemonResponse
        };
    },

   /**
    * fortRecallPokemon
    * @param {number} fortID
    * @param {number} pokemonID
    * @returns {object} POGO request object
    */
    fortRecallPokemon(fortID, pokemonID) {
        return {
            type: RequestType.FORT_RECALL_POKEMON,
            message: new RequestMessages.FortRecallPokemonMessage({
                fort_id: fortID,
                pokemon_id: pokemonID,
                player_latitude: this.playerLatitude,
                player_longitude: this.playerLongitude
            }),
            responseType: Responses.FortRecallPokemonResponse
        };
    },

   /**
    * releasePokemon: known as "transfer", receive 1 candy for releasing
    * @param {number} pokemonID
    * @returns {object} POGO request object
    */
    releasePokemon(pokemonID) {
        return {
            type: RequestType.RELEASE_POKEMON,
            message: new RequestMessages.ReleasePokemonMessage({
                pokemon_id: pokemonID
            }),
            responseType: Responses.ReleasePokemonResponse
        };
    },

   /**
    * useItemPotion
    * @param {number} itemID
    * @param {number} pokemonID
    * @returns {object} POGO request object
    */
    useItemPotion(itemID, pokemonID) {
        return {
            type: RequestType.USE_ITEM_POTION,
            message: new RequestMessages.UseItemPotionMessage({
                item_id: itemID,
                pokemon_id: pokemonID
            }),
            responseType: Responses.UseItemPotionResponse
        };
    },

   /**
    * useItemCapture
    * @param {number} itemID
    * @param {number} encounterID
    * @param {number} spawnPointID
    * @returns {object} POGO request object
    */
    useItemCapture(itemID, encounterID, spawnPointID) {
        return {
            type: RequestType.USE_ITEM_CAPTURE,
            message: new RequestMessages.UseItemCaptureMessage({
                item_id: itemID,
                encounter_id: encounterID,
                spawn_point_id: spawnPointID
            }),
            responseType: Responses.UseItemCaptureResponse
        };
    },

   /**
    * useItemRevive
    * @param {number} itemID
    * @param {number} pokemonID
    * @returns {object} POGO request object
    */
    useItemRevive(itemID, pokemonID) {
        return {
            type: RequestType.USE_ITEM_REVIVE,
            message: new RequestMessages.UseItemReviveMessage({
                item_id: itemID,
                pokemon_id: pokemonID
            }),
            responseType: Responses.UseItemReviveResponse
        };
    },

   /**
    * getPlayerProfile
    * @param {string} playerName
    * @returns {object} POGO request object
    */
    getPlayerProfile(playerName) {
        return {
            type: RequestType.GET_PLAYER_PROFILE,
            message: new RequestMessages.GetPlayerProfileMessage({
                player_name: playerName
            }),
            responseType: Responses.GetPlayerProfileResponse
        };
    },

   /**
    * getPlayerProfile
    * @param {number} pokemonID
    * @returns {object} POGO request object
    */
    evolvePokemon(pokemonID) {
        return {
            type: RequestType.EVOLVE_POKEMON,
            message: new RequestMessages.EvolvePokemonMessage({
                pokemon_id: pokemonID
            }),
            responseType: Responses.EvolvePokemonResponse
        };
    },

   /**
    * getHatchedEggs
    * @returns {object} POGO request object
    */
    getHatchedEggs() {
        return {
            type: RequestType.GET_HATCHED_EGGS,
            responseType: Responses.GetHatchedEggsResponse
        };
    },

   /**
    * encounterTutorialComplete
    * @param {number} pokemonID
    * @returns {object} POGO request object
    */
    encounterTutorialComplete(pokemonID) {
        return {
            type: RequestType.ENCOUNTER_TUTORIAL_COMPLETE,
            message: new RequestMessages.EncounterTutorialCompleteMessage({
                pokemon_id: pokemonID
            }),
            responseType: Responses.EncounterTutorialCompleteResponse
        };
    },

   /**
    * levelUpRewards
    * @param {number} level
    * @returns {object} POGO request object
    */
    levelUpRewards(level) {
        return {
            type: RequestType.LEVEL_UP_REWARDS,
            message: new RequestMessages.LevelUpRewardsMessage({
                level: level
            }),
            responseType: Responses.LevelUpRewardsResponse
        };
    },

    checkAwardedBadges() {
        return {
            type: RequestType.CHECK_AWARDED_BADGES,
            responseType: Responses.CheckAwardedBadgesResponse
        };
    },

    useItemGym(itemID, gymID) {
        return {
            type: RequestType.USE_ITEM_GYM,
            message: new RequestMessages.UseItemGymMessage({
                item_id: itemID,
                gym_id: gymID,
                player_latitude: this.playerLatitude,
                player_longitude: this.playerLongitude
            }),
            responseType: Responses.UseItemGymResponse
        };
    },

    getGymDetails(gymID, gymLatitude, gymLongitude) {
        return {
            type: RequestType.GET_GYM_DETAILS,
            message: new RequestMessages.GetGymDetailsMessage({
                gym_id: gymID,
                player_latitude: this.playerLatitude,
                player_longitude: this.playerLongitude,
                gym_latitude: gymLatitude,
                gym_longitude: gymLongitude
            }),
            responseType: Responses.GetGymDetailsResponse
        };
    },

    startGymBattle(gymID, attackingPokemonIDs, defendingPokemonID) {
        return {
            type: RequestType.START_GYM_BATTLE,
            message: new RequestMessages.StartGymBattleMessage({
                gym_id: gymID,
                attacking_pokemon_ids: attackingPokemonIDs,
                defending_pokemon_id: defendingPokemonID,
                player_latitude: this.playerLatitude,
                player_longitude: this.playerLongitude
            }),
            responseType: Responses.StartGymBattleResponse
        };
    },

    attackGym(gymID, battleID, attackActions, lastRetrievedAction) {
        return {
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
        };
    },

    recycleInventoryItem(itemID, count) {
        return {
            type: RequestType.RECYCLE_INVENTORY_ITEM,
            message: new RequestMessages.RecycleInventoryItemMessage({
                item_id: itemID,
                count: count
            }),
            responseType: Responses.RecycleInventoryItemResponse
        };
    },

    collectDailyBonus() {
        return {
            type: RequestType.COLLECT_DAILY_BONUS,
            responseType: Responses.CollectDailyBonusResponse
        };
    },

    useItemXPBoost(itemID) {
        return {
            type: RequestType.USE_ITEM_XP_BOOST,
            message: new RequestMessages.UseItemXpBoostMessage({
                item_id: itemID
            }),
            responseType: Responses.UseItemXpBoostResponse
        };
    },

    useItemEggIncubator(itemID, pokemonID) {
        return {
            type: RequestType.USE_ITEM_EGG_INCUBATOR,
            message: new RequestMessages.UseItemEggIncubatorMessage({
                item_id: itemID,
                pokemon_id: pokemonID
            }),
            responseType: Responses.UseItemEggIncubatorResponse
        };
    },

    useIncense(itemID) {
        return {
            type: RequestType.USE_INCENSE,
            message: new RequestMessages.UseIncenseMessage({
                incense_type: itemID
            }),
            responseType: Responses.UseIncenseResponse
        };
    },

    getIncensePokemon() {
        return {
            type: RequestType.GET_INCENSE_POKEMON,
            message: new RequestMessages.GetIncensePokemonMessage({
                player_latitude: this.playerLatitude,
                player_longitude: this.playerLongitude
            }),
            responseType: Responses.GetIncensePokmeonResponse
        };
    },

    incenseEncounter(encounterID, encounterLocation) {
        return {
            type: RequestType.INCENSE_ENCOUNTER,
            message: new RequestMessages.IncenseEncounterMessage({
                encounter_id: encounterID,
                encounter_location: encounterLocation
            }),
            responseType: Responses.IncenseEncounterResponse
        };
    },

    addFortModifier(modifierItemID, fortID) {
        return {
            type: RequestType.ADD_FORT_MODIFIER,
            message: new RequestMessages.AddFortModifierMessage({
                modifier_type: modifierItemID,
                fort_id: fortID,
                player_latitude: this.playerLatitude,
                player_longitude: this.playerLongitude
            })
        };
    },

    diskEncounter(encounterID, fortID) {
        return {
            type: RequestType.DISK_ENCOUNTER,
            message: new RequestMessages.DiskEncounterMessage({
                encounter_id: encounterID,
                fort_id: fortID,
                player_latitude: this.playerLatitude,
                player_longitude: this.playerLongitude
            }),
            responseType: Responses.DiskEncounterResponse
        };
    },

    collectDailyDefenderBonus() {
        return {
            type: RequestType.COLLECT_DAILY_DEFENDER_BONUS,
            responseType: Responses.CollectDailyDefenderBonusResponse
        };
    },

    upgradePokemon(pokemonID) {
        return {
            type: RequestType.UPGRADE_POKEMON,
            message: new RequestMessages.UpgradePokemonMessage({
                pokemon_id: pokemonID
            }),
            responseType: Responses.UpgradePokemonResponse
        };
    },

    setFavoritePokemon(pokemonID, isFavorite) {
        return {
            type: RequestType.SET_FAVORITE_POKEMON,
            message: new RequestMessages.SetFavoritePokemonMessage({
                pokemon_id: pokemonID,
                is_favorite: isFavorite
            }),
            responseType: Responses.SetFavoritePokemonResponse
        };
    },

    nicknamePokemon(pokemonID, nickname) {
        return {
            type: RequestType.NICKNAME_POKEMON,
            message: new RequestMessages.NicknamePokemonMessage({
                pokemon_id: pokemonID,
                nickname: nickname
            }),
            responseType: Responses.NicknamePokemonResponse
        };
    },

    equipBadge(badgeType) {
        return {
            type: RequestType.EQUIP_BADGE,
            message: new RequestMessages.EquipBadgeMessage({
                badge_type: badgeType
            }),
            responseType: Responses.EquipBadgeResponse
        };
    },

    setContactSettings(sendMarketingEmails, sendPushNotifications) {
        return {
            type: RequestType.SET_CONTACT_SETTINGS,
            message: new RequestMessages.SetContactSettingsMessage({
                contact_settings: {
                    send_marketing_emails: sendMarketingEmails,
                    send_push_notifications: sendPushNotifications
                }
            }),
            responseType: Responses.SetContactSettingsResponse
        };
    },

    getAssetDigest(platform, deviceManufacturer, deviceModel, locale, appVersion) {
        return {
            type: RequestType.GET_ASSET_DIGEST,
            message: new RequestMessages.GetAssetDigestMessage({
                platform: platform,
                device_manufacturer: deviceManufacturer,
                device_model: deviceModel,
                locale: locale,
                app_version: appVersion
            }),
            responseType: Responses.GetAssetDigestResponse
        };
    },

    getDownloadURLs(assetIDs) {
        return {
            type: RequestType.GET_DOWNLOAD_URLS,
            message: new RequestMessages.GetDownloadUrlsMessage({
                asset_id: assetIDs
            }),
            responseType: Responses.GetDownloadUrlsResponse
        };
    },

    getSuggestedCodenames() {
        return {
            type: RequestType.GET_SUGGESTED_CODENAMES,
            responseType: Responses.GetSuggestedCodenamesResponse
        };
    },

    checkCodenameAvailable(codename) {
        return {
            type: RequestType.CHECK_CODENAME_AVAILABLE,
            message: new RequestMessages.CheckCodenameAvailableMessage({
                codename: codename
            }),
            responseType: Responses.CheckCodenameAvailableResponse
        };
    },

    claimCodename(codename) {
        return {
            type: RequestType.CLAIM_CODENAME,
            message: new RequestMessages.ClaimCodenameMessage({
                codename: codename
            }),
            responseType: Responses.ClaimCodenameResponse
        };
    },

    setAvatar(skin, hair, shirt, pants, hat, shoes, gender, eyes, backpack) {
        return {
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
        };
    },

    setPlayerTeam(teamColor) {
        return {
            type: RequestType.SET_PLAYER_TEAM,
            message: new RequestMessages.SetPlayerTeamMessage({
                team: teamColor
            }),
            responseType: Responses.SetPlayerTeamResponse
        };
    },

    markTutorialComplete(tutorialsCompleted, sendMarketingEmails, sendPushNotifications) {
        return {
            type: RequestType.MARK_TUTORIAL_COMPLETE,
            message: new RequestMessages.MarkTutorialCompleteMessage({
                tutorials_completed: tutorialsCompleted,
                send_marketing_emails: sendMarketingEmails,
                send_push_notifications: sendPushNotifications
            }),
            responseType: Responses.MarkTutorialCompleteResponse
        };
    },

    echo() {
        return {
            type: RequestType.ECHO,
            responseType: Responses.EchoResponse
        };
    },

    sfidaActionLog() {
        return {
            type: RequestType.SFIDA_ACTION_LOG,
            responseType: Responses.SfidaActionLogResponse
        };
    }

};
