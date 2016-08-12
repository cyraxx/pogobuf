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

const signatureBuilder = new pogoSignature.Builder();
const RequestType = POGOProtos.Networking.Requests.RequestType;
const httpClient = http.defaults({
    headers: {
        'User-Agent': 'Niantic App',
        'Accept': '*/*',
        'Content-Type': 'application/x-www-form-urlencoded'
    },
    encoding: null
});

/**
 * Pokémon Go Request
 * @class Client
 * @memberof pogobuf
 */
class EnvelopeRequest {

    constructor() {
        this.requests = [];
        this.client = this;
        this.envelope = null;
        this.containsMapCall = false;
        this.try = 0;
    }
    
    /**
     * Build Envelope and through RPC call
     * @param {object} req
     * @param {array} requests
     * @returns {promise} shit
     */
    call(req, requests) {
        let getEnvelope;

        if (req.envelope) {
            getEnvelope = Promise.resolve(req.envelope);
        } else {
            getEnvelope = this.buildEnvelope(() => this.signEnvelope(basicEnvelope)).then(envelope => {
                req.envelope = envelope;
                return envelope;
            });
        }

        // If needed, delay request for getMapObjects()
        if (req._containsMapCall && this.options.mapObjectsThrottling) {
            let now = new Date().getTime(),
                delayNeeded = this.lastMapObjectsCall + (this.options.mapObjectsMinDelay * 1000) - now;

            if (delayNeeded > 0) {
                console.log('DELAYING MAP REQUEST BY', delayNeeded);
                return Promise.delay(delayNeeded).then(() => this.call(req));
            }
            this.lastMapObjectsCall = now;
        }

        return getEnvelope.then(envelope => this.callRPC(envelope, requests)).catch(reason => {
            if (reason.abort) throw reason;
            if (++req._try >= this.options.retryMax) throw new Error('RPC Call passed retry limit:' + reason);
            let delay = this.options.retryDelay * this.options.retryBackoff * req._try;
            console.log('DELAYING BY ' + delay + ' MS');
            return Promise.delay(delay).then(() => this.call(req));
        });
    }

    /**
     * Creates an RPC envelope with the given list of requests.
     * @private
     * @param {Object[]} requests - Array of requests to build
     * @return {POGOProtos.Networking.Envelopes.RequestEnvelope}
     */
    buildEnvelope() {
        return new Promise((resolve) => {
            let envelope = {
                status_code: 2,
                request_id: this.client.getRequestID(), // TODO: move to utils?
                unknown12: 989
            };

            if (this.client.playerLatitude) envelope.latitude = this.client.playerLatitude;
            if (this.client.playerLongitude) envelope.longitude = this.client.playerLongitude;
            if (this.client.playerAltitude) envelope.altitude = this.client.playerAltitude;

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

            this.emit('request-envelope', envelope);

            resolve(new POGOProtos.Networking.Envelopes.RequestEnvelope(envelope));
        });
    }
    /**
     * Creates an RPC envelope with the given list of requests and adds the encrypted signature,
     * or adds the signature to an existing envelope.
     * @private
     * @param {RequestEnvelope} [envelope] - Pre-built request envelope to sign
     * @return {Promise} - A Promise that will be resolved with a RequestEnvelope instance
     */
    signEnvelope() {
        return new Promise((resolve, reject) => {
            if (!this.envelope.auth_ticket) resolve(envelope);

            signatureBuilder.setAuthTicket(envelope.auth_ticket);
            signatureBuilder.setLocation(envelope.latitude, envelope.longitude, envelope.altitude);
            signatureBuilder.encrypt(envelope.requests, (err, sigEncrypted) => {
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
