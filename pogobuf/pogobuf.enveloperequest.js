'use strict';

const
    crypto = require('crypto'),
    Long = require('long'),
    POGOProtos = require('node-pogo-protos'),
    pogoSignature = require('node-pogo-signature'),
    Promise = require('bluebird'),
    http = require('request'),
    Utils = require('./pogobuf.utils.js'),
    methods = require('./pogobuf.methods.js');

const INITIAL_ENDPOINT = 'https://pgorelease.nianticlabs.com/plfe/rpc';
const signatureBuilder = new pogoSignature.Builder();
const RequestType = POGOProtos.Networking.Requests.RequestType;
const httpClient = http.defaults({
    method: 'POST',
    headers: {
        'User-Agent': 'Niantic App',
        'Accept': '*/*',
        'Content-Type': 'application/x-www-form-urlencoded'
    },
    encoding: null
});

/**
 * Custom Error object, allows defining additional properties
 * @param {string} message - The error message
 * @param {bool} fatal - Can the request be retried
 * @param {number|null} statusCode - Received RPC status_code
 */
function RequestError(message, fatal = false, statusCode = null) {
    this.name = 'RequestError';
    this.message = message;
    this.fatal = fatal;
    this.status_code = statusCode;
    this.stack = (new Error()).stack;
}

/**
 * Pokémon Go EnvelopeRequest
 * @class EnvelopeRequest
 * @memberof pogobuf
 */
class EnvelopeRequest {

    constructor(client) {
        this.requests = [];
        this.client = client;
        this.envelope = null;
        this.containsMapCall = false;
        this.try = 0;
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
     * Build, send and decode the EnvelopeRequest
     * @returns {promise} fufills when EnvelopeRequest recieved and decoded successful result
     */
    call() {
        return this.client.sendEnvelopeRequest(this);
    }

    /**
     * Creates an RPC envelope with the given list of requests.
     * @private
     * @param {Object[]} options - Array of requests to build
     * @return {POGOProtos.Networking.Envelopes.RequestEnvelope}
     */
    buildEnvelope(options) {
        return new Promise((resolve) => {
            let envelope = {
                status_code: 2,
                request_id: this.getRequestID(), // TODO: move to utils?
                unknown12: 989
            };

            if (options.latitude) envelope.latitude = options.latitude;
            if (options.longitude) envelope.longitude = options.longitude;
            if (options.altitude) envelope.altitude = options.altitude;

            if (this.client.authTicket) {
                envelope.auth_ticket = this.client.authTicket;
            } else if (!this.client.authType || !this.client.authToken) {
                throw Error('No auth info provided');
            } else {
                envelope.auth_info = {
                    provider: this.client.authType,
                    token: {
                        contents: this.client.authToken,
                        unknown2: 59
                    }
                };
            }

            if (this.requests.length) {
                this.client.emit('request', {
                    request_id: envelope.request_id.toString(),
                    requests: this.requests.map(request => ({
                        name: Utils.getEnumKeyByValue(RequestType, request.type),
                        type: request.type,
                        data: request.message
                    }))
                });

                envelope.requests = this.requests.map(request => ({
                    request_type: request.type,
                    request_message: request.message ? request.message.encode() : undefined
                }));
            }

            this.client.emit('request-envelope', envelope);

            this.envelope = new POGOProtos.Networking.Envelopes.RequestEnvelope(envelope);
            resolve(this.envelope);
        });
    }

    /**
     * Creates an RPC envelope with the given list of requests and adds the encrypted signature,
     * or adds the signature to an existing envelope.
     * @private
     * @param {RequestEnvelope} [envelope] - Pre-built request envelope to sign
     * @return {Promise} - A Promise that will be resolved with a RequestEnvelope instance
     */
    signEnvelope(options) {
        return new Promise((resolve, reject) => {
            if (!options.auth_ticket) resolve(this.envelope);

            signatureBuilder.setAuthTicket(options.auth_ticket);
            signatureBuilder.setLocation(this.envelope.latitude, this.envelope.longitude, this.envelope.altitude);
            signatureBuilder.encrypt(this.envelope.requests, (err, sigEncrypted) => {
                if (err) return reject(new Error(err));

                this.envelope.unknown6.push(new POGOProtos.Networking.Envelopes.Unknown6({
                    request_type: 6,
                    unknown2: new POGOProtos.Networking.Envelopes.Unknown6.Unknown2({
                        encrypted_signature: sigEncrypted
                    })
                }));

                return resolve(this.envelope);
            });
        });
    }

    /**
     * Sends the envelope
     * @return {Promise} - A Promise that will be resolved with a RequestEnvelope instance
     */
    send(options) {
        return new Promise((resolve, reject) => {
            if (!this.envelope) return reject(new RequestError('Cannot send EnvelopeRequest, envelope is not build', true));
            httpClient({
                url: options.endpoint,
                proxy: options.proxy,
                body: this.envelope.toBuffer()
            }, (err, response, body) => {
                if (err) reject(new Error(err));
                resolve([response, body]);
            });
        }).spread((response, body) => {
            if (response.statusCode === 200) {
                return body;
            }
            if (response.statusCode >= 400 && response.statusCode < 500) {
                /* These are permanent errors so throw StopError */
                throw new RequestError(`Status code ${response.statusCode} received from HTTPS request`, true);
            }
            /* Anything else might be recoverable so throw regular Error */
            throw Error(`Status code ${response.statusCode} received from HTTPS request`);
        });
    }

    /**
     * Decode the response body from `send()`
     * @return {Promise} - A Promise that will be resolved decoded response
     */
    decode(body) {
        return new Promise((resolve, reject) => {
            let envelope;
            try {
                envelope = POGOProtos.Networking.Envelopes.ResponseEnvelope.decode(body);
            } catch (error) {
                this.client.emit('parse-envelope-error', body, error);
                if (error.decoded) {
                    envelope = error.decoded;
                } else {
                    throw new retry.StopError(error);
                }
            }

            this.client.emit('response-envelope', envelope);

            if (envelope.error) {
                return reject(new RequestError(envelope.error, true));
            }

            if (envelope.auth_ticket) this.client.authTicket = envelope.auth_ticket;

            if (this.client.endpoint === INITIAL_ENDPOINT) {
                /* status_code 102 seems to be invalid auth token,
                   could use later when caching token. */
                if (envelope.status_code !== 53) {
                    return reject(new RequestError(
                        'Fetching RPC endpoint failed, received status code ' + envelope.status_code,
                        false,
                        envelope.status_code
                    ));
                }

                if (!envelope.api_url) {
                    return reject(new RequestError('Fetching RPC endpoint failed, none supplied in response', true));
                }

                this.client.endpoint = 'https://' + envelope.api_url + '/rpc';

                this.client.emit('endpoint-response', {
                    status_code: envelope.status_code,
                    request_id: envelope.request_id.toString(),
                    api_url: envelope.api_url
                });

                // return reject(new RequestError('RPC responded with 53 redirect', true, 53));
            }

            /* These codes indicate invalid input, no use in retrying so throw StopError */
            if (envelope.status_code === 3 || envelope.status_code === 102) {
                throw new RequestError(
                    `Status code ${envelope.status_code} received from RPC`,
                    true,
                    envelope.status_code
                );
            }

            /* These can be temporary so throw regular Error */
            if (!~[1, 2, 53].indexOf(envelope.status_code)) {
                return reject(new RequestError(
                    `Status code ${envelope.status_code} received from RPC`,
                    false,
                    envelope.status_code
                ));
            }

            let responses = [];

            if (this.requests) {
                if (this.requests.length !== envelope.returns.length) {
                    return reject(new RequestError('Request count does not match response count'));
                }

                for (let i = 0; i < envelope.returns.length; i++) {
                    if (!this.requests[i].responseType) continue;

                    let responseMessage;
                    try {
                        responseMessage = this.requests[i].responseType.decode(envelope.returns[i]);
                    } catch (err) {
                        this.client.emit('parse-response-error', envelope.returns[i].toBuffer(), err);
                        return reject(new RequestError(err));
                    }

                    responses.push(responseMessage);
                }
            }

            this.client.emit('response', {
                status_code: envelope.status_code,
                request_id: envelope.request_id.toString(),
                responses: responses.map((request, h) => ({
                    name: Utils.getEnumKeyByValue(RequestType, this.requests[h].type),
                    type: this.requests[h].type,
                    data: request
                }))
            });

            resolve([responses, envelope]);
        });
    }
}

for (let method in methods) {
    if (methods.hasOwnProperty(method)) {
        Object.defineProperty(EnvelopeRequest.prototype, method, {
            value: function(...args) {
                let req = methods[method].call(this.client, ...args);
                if (req.type === RequestType.GET_MAP_OBJECTS) {
                    this.containsMapCall = true;
                }
                this.requests.push(req);
                return this;
            }
        });
    }
}

module.exports = EnvelopeRequest;
