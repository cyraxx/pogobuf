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
    Utils = require('./pogobuf.utils.js'),
    methods = require('./pogobuf.methods.js');

const RequestType = POGOProtos.Networking.Requests.RequestType;
const INITIAL_ENDPOINT = 'https://pgorelease.nianticlabs.com/plfe/rpc';
const DEFAULTOPTIONS = {
    proxy: null,
    mapObjectsThrottling: true,
    mapObjectsMinDelay: 5,
    maxTries: 5,
    appVersion: '0.31.1'
};

const RETRYSETTINGS = {
    delay: 300,
    backoff: 2,
    tries: 5
};

/**
 * Pokémon Go RPC client.
 * @class Client
 * @memberof pogobuf
 */
class Client extends EventEmitter {

    constructor() {
        super();
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
     * @param {object} options - Set options for the client
     * @param {string} object.proxy - Sets a proxy address to use for the HTTPS RPC requests.
     * @param {bool} object.mapObjectsThrottling - Enables or disables the
     * built-in throttling of getMapObjects() calls
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
        this.rpcRequest = request.defaults({
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
        return this.batch()
            .getPlayer(this.options.appVersion)
            .getHatchedEggs()
            .getInventory()
            .checkAwardedBadges()
            .downloadSettings()
            .call();
    }

    /**
     * Create a batch call
     * @returns {object} batch request object
     */
    batch() {
        let req = {
            _requests: [],
            _client: this,
            _envelope: null,
            _containsMapCall: false,
            _try: 0,
            call: function() {
                return this._client.call.call(this._client, this, this._requests);
            }
        };
        for (let method in methods) {
            if (methods.hasOwnProperty(method)) {
                Object.defineProperty(req, method, {
                    enumerable: true,
                    value: function(...args) {
                        let _request = methods[method].call(this._client, ...args);
                        if (_request.type === RequestType.GET_MAP_OBJECTS) {
                            this._containsMapCall = true;
                        }
                        this._requests.push(_request);
                        return this;
                    }
                });
            }
        }
        return req;
    }

    /**
     * The batch call method, execute a request
     * @param {object} req
     * @param {array} requests
     * @returns {promise} shit
     */
    call(req, requests) {
        let getEnvelope;

        if (req._envelope) {
            getEnvelope = Promise.resolve(req._envelope);
        } else {
            let basicEnvelope = this.buildEnvelope(requests);
            getEnvelope = this.signEnvelope(basicEnvelope).then(signedEnvelope => {
                req._envelope = signedEnvelope;
                return signedEnvelope;
            });
        }

        // If needed, delay request for getMapObjects()
        if (req._containsMapCall && this.options.mapObjectsThrottling) {
            let now = new Date().getTime(),
                delayNeeded = this.lastMapObjectsCall + (this.options.mapObjectsMinDelay * 1000) - now;

            if (delayNeeded > 0) {
                return Promise.delay(delayNeeded).then(() => this.call(req));
            }
            this.lastMapObjectsCall = now;
        }

        return getEnvelope.then(envelope => this.callRPC(envelope, requests)).catch(reason => {
            if (reason.abort) throw reason;
            if (++req._try >= RETRYSETTINGS.tries) throw new Error('RPC Call passed retry limit:' + reason);
            let delay = RETRYSETTINGS.delay * RETRYSETTINGS.backoff * req._try;
            return Promise.delay(delay).then(() => this.call(req));
        });
    }

    /**
     * Executes an RPC call with the given request envelope
     * @private
     * @param {RequestEnvelope} [envelope] - Pre-built request envelope to use
     * @param {object} requests
     * @return {Promise} - A Promise that will be resolved with the (list of) response messages,
     *     or true if there aren't any
     */
    callRPC(envelope, requests) {
        console.log('REQUEST BEING DONE');
        return this.sendRequest(envelope).then(body => {
            let responseEnvelope;
            try {
                responseEnvelope = POGOProtos.Networking.Envelopes.ResponseEnvelope.decode(body);
            } catch (error) {
                this.emit('parse-envelope-error', body, error);
                if (error.decoded) {
                    responseEnvelope = error.decoded;
                } else {
                    throw new retry.StopError(error);
                }
            }

            this.emit('raw-response', responseEnvelope);

            if (responseEnvelope.error) {
                throw new retry.StopError(responseEnvelope.error);
            }

            if (responseEnvelope.auth_ticket) this.authTicket = responseEnvelope.auth_ticket;

            if (this.endpoint === INITIAL_ENDPOINT) {
                /* status_code 102 seems to be invalid auth token,
                   could use later when caching token. */
                if (responseEnvelope.status_code !== 53) {
                    throw new Error('Fetching RPC endpoint failed, received status code ' +
                        responseEnvelope.status_code);
                }

                if (!responseEnvelope.api_url) {
                    throw new Error('Fetching RPC endpoint failed, none supplied in response');
                }

                this.endpoint = 'https://' + responseEnvelope.api_url + '/rpc';

                this.emit('endpoint-response', {
                    status_code: responseEnvelope.status_code,
                    request_id: responseEnvelope.request_id.toString(),
                    api_url: responseEnvelope.api_url
                });

                return this.callRPC(envelope, requests);
            }

            /* These codes indicate invalid input, no use in retrying so throw StopError */
            if (responseEnvelope.status_code === 3 || responseEnvelope.status_code === 102) {
                throw new retry.StopError(
                    `Status code ${responseEnvelope.status_code} received from RPC`);
            }

            /* These can be temporary so throw regular Error */
            if (responseEnvelope.status_code !== 2 && responseEnvelope.status_code !== 1) {
                throw new Error(`Status code ${responseEnvelope.status_code} received from RPC`);
            }

            let responses = [];

            if (requests) {
                if (requests.length !== responseEnvelope.returns.length) {
                    throw new Error('Request count does not match response count');
                }

                for (let i = 0; i < responseEnvelope.returns.length; i++) {
                    if (!requests[i].responseType) continue;

                    let responseMessage;
                    try {
                        responseMessage = requests[i].responseType.decode(responseEnvelope.returns[
                            i]);
                    } catch (e) {
                        this.emit('parse-response-error', responseEnvelope.returns[i].toBuffer(), e);
                        throw new retry.StopError(e);
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

            if (!responses.length) return null;
            else if (responses.length === 1) return responses[0];
            else return responses;
        });
    }

    /**
     * Creates an RPC envelope with the given list of requests and adds the encrypted signature,
     * or adds the signature to an existing envelope.
     * @private
     * @param {RequestEnvelope} [envelope] - Pre-built request envelope to sign
     * @return {Promise} - A Promise that will be resolved with a RequestEnvelope instance
     */
    signEnvelope(envelope) {
        return new Promise((resolve, reject) => {
            if (!envelope.auth_ticket) resolve(envelope);

            this.signatureBuilder.setAuthTicket(envelope.auth_ticket);
            this.signatureBuilder.setLocation(envelope.latitude, envelope.longitude, envelope.altitude);

            this.signatureBuilder.encrypt(envelope.requests, (err, sigEncrypted) => {
                if (err) return reject(new Error(err));

                envelope.unknown6.push(new POGOProtos.Networking.Envelopes.Unknown6({
                    request_type: 6,
                    unknown2: new POGOProtos.Networking.Envelopes.Unknown6.Unknown2({
                        encrypted_signature: sigEncrypted
                    })
                }));

                return resolve(envelope);
            });
        });
    }

    /**
     * Change a option in the client, see init for more info
     * @param {string} key - The name of the option
     * @param {mixed} val - The new value of the option
     */
    setOption(key, val) {
        if (this.options.hasOwnProperty(key)) {
            this.options[key] = val;
        }
    }

    /**
     * Generates a random request ID
     * @private
     * @return {Long}
     */
    getRequestID() {
        let bytes = crypto.randomBytes(8);
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
        let envelopeData = {
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
                let requestData = {
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

    sendRequest(envelope) {
        return new Promise((resolve, reject) => {
            this.rpcRequest({
                method: 'POST',
                url: this.endpoint,
                proxy: this.proxy,
                body: envelope.toBuffer()
            }, (err, response, body) => {
                if (err) reject(Error(err));
                resolve([response, body]);
            });
        }).spread((response, body) => {
            if (response.statusCode === 200) return body;
            if (response.statusCode >= 400 && response.statusCode < 500) {
                /* These are permanent errors so throw StopError */
                throw new retry.StopError(`Status code ${response.statusCode} received from HTTPS request`);
            } else {
                /* Anything else might be recoverable so throw regular Error */
                throw Error(`Status code ${response.statusCode} received from HTTPS request`);
            }
        });
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
            let settingsResponse = responses[4];
            if (!settingsResponse.error &&
                settingsResponse.settings &&
                settingsResponse.settings.map_settings &&
                settingsResponse.settings.map_settings.get_map_objects_min_refresh_seconds
            ) {
                this.setOption(
                  'mapObjectsMinDelay',
                  settingsResponse.settings.map_settings.get_map_objects_min_refresh_seconds
                );
            }
        }
        return responses;
    }
}

for (let method in methods) {
    if (methods.hasOwnProperty(method)) {
        Object.defineProperty(Client.prototype, method, {
            value: function(...args) {
                let batch = this.batch();
                batch[method](...args);
                return batch.call();
                // return this.callRPC([this.makeRequest(method, ...args)]);
            }
        });
    }
}

module.exports = Client;
