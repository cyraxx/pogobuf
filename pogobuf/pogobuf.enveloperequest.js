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
RequestError.prototype.toString = function() {
    let stack = this.stack.split('\n').slice(2).join('\n');
    return `${this.name}: ${this.message}\n${stack}`;
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
                request_id: this.getRequestID(),
                unknown12: 989
            };

            if (options.latitude) envelope.latitude = options.latitude;
            if (options.longitude) envelope.longitude = options.longitude;
            if (options.altitude) envelope.altitude = options.altitude;

            if (options.authTicket) {
                envelope.auth_ticket = options.authTicket;
            } else if (options.authType && options.authToken) {
                envelope.auth_info = {
                    provider: options.authType,
                    token: {
                        contents: options.authToken,
                        unknown2: 59
                    }
                };
            } else {
                throw Error('No auth info provided');
            }

            if (this.requests.length > 0) {
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
                    request_message: request.message ? request.message.encode() : undefined // eslint-disable-line
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
     * @param {object} options
     * @param {string} options.auth_ticket
     * @return {Promise} - A Promise that will be resolved with a RequestEnvelope instance
     */
    signEnvelope(options) {
        return new Promise((resolve, reject) => {
            if (!options.authTicket) resolve(this.envelope);

            signatureBuilder.setAuthTicket(options.authTicket);
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
     * @param {object} options
     * @param {string} options.endpoint
     * @param {string} options.proxy
     * @return {Promise} - A Promise that will be resolved with a RequestEnvelope instance
     */
    send(options) {
        return new Promise((resolve, reject) => {
            if (!this.envelope) {
                return reject(new RequestError('Cannot send EnvelopeRequest, envelope is not build', true));
            }
            return httpClient({
                url: options.endpoint,
                proxy: options.proxy,
                body: this.envelope.toBuffer()
            }, (err, response, body) => {
                if (err) reject(new Error(err));
                resolve([response, body]);
            });
        }).spread((response, body) => {
            if (response.statusCode >= 400 && response.statusCode < 500) {
                /* These are permanent errors so throw StopError */
                throw new RequestError(`Status code ${response.statusCode} received from HTTPS request`, true);
            } else if (response.statusCode !== 200) {
                /* Anything else might be recoverable so throw regular Error */
                throw Error(`Status code ${response.statusCode} received from HTTPS request`);
            }
            return body;
        });
    }

    /**
     * Decode the response envelope with POGOProtos
     * @param {buffer} envelope
     * @return {Promise}
     */
    decodeEnvelope(envelope) {
        return new Promise((resolve, reject) => {
            try {
                resolve(POGOProtos.Networking.Envelopes.ResponseEnvelope.decode(envelope));
            } catch (error) {
                this.client.emit('parse-envelope-error', envelope, error);

                if (error.decoded) {
                    resolve(error.decoded);
                } else {
                    error.fatal = true;
                    reject(error);
                }
            }
        });
    }

    /**
     * Decode the response body from `send()`
     * @param {buffer} body - encoded ResponseEnvelope
     * @return {Promise} A Promise that will be resolved decoded response
     */
    decode(body) {
        return this.decodeEnvelope(body).then(envelope => {
            this.client.emit('response-envelope', envelope);

            if (envelope.error) {
                throw new RequestError(envelope.error, true);
            }

            let fatalStatusCodes = [3, 102],
                successStatusCodes = [1, 2, 53],
                responses = [];

            if (~fatalStatusCodes.indexOf(envelope.status_code)) {
                throw new RequestError(
                    `Status code ${envelope.status_code} received from RPC`,
                    true,
                    envelope.status_code
                );
            }

            if (!~successStatusCodes.indexOf(envelope.status_code)) {
                throw new RequestError(
                    `Status code ${envelope.status_code} received from RPC`,
                    false,
                    envelope.status_code
                );
            }

            if (this.requests && envelope.status_code !== 53) {
                if (this.requests.length !== envelope.returns.length) {
                    throw new RequestError('Request count does not match response count');
                }

                this.requests.forEach((request, i) => {
                    if (!request.responseType) return;

                    try {
                        responses.push(request.responseType.decode(envelope.returns[i]));
                    } catch (err) {
                        this.client.emit('parse-response-error', envelope.returns[i].toBuffer(), err);
                        throw new RequestError(err);
                    }
                });
            }

            this.client.emit('response', {
                status_code: envelope.status_code,
                request_id: envelope.request_id.toString(),
                responses: responses.map((request, i) => ({
                    name: Utils.getEnumKeyByValue(RequestType, this.requests[i].type),
                    type: this.requests[i].type,
                    data: request
                }))
            });

            return [responses, envelope];
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
