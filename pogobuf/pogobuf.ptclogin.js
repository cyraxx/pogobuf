/*eslint no-underscore-dangle: ["error", { "allow": ["_eventId"] }]*/
'use strict';

const request = require('request'),
    Promise = require('bluebird');

/**
 * Pokémon Trainer Club login client.
 * @class PTCLogin
 * @memberof pogobuf
 */
function PTCLogin() {
    if (!(this instanceof PTCLogin)) {
        return new PTCLogin();
    }

    const self = this;
    this.proxy = undefined;
    this.cookies = undefined;

    /**
     * Reset login so it can be reused
     */
    this.reset = function() {
        self.cookies = request.jar();
        self.request = request.defaults({
            headers: {
                'User-Agent': 'niantic'
            },
            jar: self.cookies,
        });
        Promise.promisifyAll(self.request);
    };

    this.reset();

    /**
     * Performs the PTC login process and returns a Promise that will be resolved with the
     * auth token.
     * @param {string} username
     * @param {string} password
     * @return {Promise}
     */
    this.login = function(username, password) {
        return self.getSession()
            .then(sessionData => self.getTicket(sessionData, username, password));
    };

    /**
     * Starts a session on the PTC website and returns a Promise that will be resolved with
     * the session parameters lt and execution.
     * @private
     * @return {Promise}
     */
    this.getSession = function() {
        return self.request.getAsync({
            url: 'https://sso.pokemon.com/sso/oauth2.0/authorize',
            qs: {
                client_id: 'mobile-app_pokemon-go',
                redirect_uri: 'https://www.nianticlabs.com/pokemongo/error',
                locale: 'en_US',
            },
            proxy: self.proxy,
        })
        .then(response => {
            const body = response.body;

            if (response.statusCode !== 200) {
                throw new Error(`Status ${response.statusCode} received from PTC login`);
            }

            var sessionResponse = null;
            try {
                sessionResponse = JSON.parse(body);
            } catch (e) {
                throw new Error('Unexpected response received from PTC login (invalid json)');
            }

            if (!sessionResponse || !sessionResponse.lt && !sessionResponse.execution) {
                throw new Error('No session data received from PTC login');
            }

            return sessionResponse;
        });
    };

    /**
     * Performs the actual login on the PTC website and returns a Promise that will be resolved
     * with a login ticket.
     * @private
     * @param {Object} sessionData - Session parameters from the {@link #getSession} method
     * @param {string} username
     * @param {string} password
     * @return {Promise}
     */
    this.getTicket = function(sessionData, username, password) {
        sessionData._eventId = 'submit';
        sessionData.username = username;
        sessionData.password = password;
        sessionData.locale = 'en_US';

        return self.request.postAsync({
            url: 'https://sso.pokemon.com/sso/login',
            qs: {
                service: 'https://sso.pokemon.com/sso/oauth2.0/callbackAuthorize',
            },
            form: sessionData,
            proxy: self.proxy,
        })
        .then(response => {
            if (response.headers['set-cookie'] && response.headers['set-cookie'].length > 0) {
                const cookieString = response.headers['set-cookie'].filter(c => c.startsWith('CASTGC'));
                if (cookieString) {
                    const cookie = request.cookie(cookieString[0]);
                    return cookie.value;
                }
            }
            throw new Error('Unable to parse token in response from PTC login.');
        });
    };

    /**
     * Sets a proxy address to use for PTC logins.
     * @param {string} proxy
     */
    this.setProxy = function(proxy) {
        self.proxy = proxy;
    };
}

module.exports = PTCLogin;
