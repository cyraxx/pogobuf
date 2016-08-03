'use strict';

const request = require('request'),
    querystring = require('querystring'),
    url = require('url');

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

    /**
     * Performs the PTC login process and returns a Promise that will be resolved with the
     * auth token.
     * @param {string} username
     * @param {string} password
     * @return {Promise}
     */
    this.login = function(username, password) {
        self.request = request.defaults({
            headers: {
                'User-Agent': 'Niantic App'
            },
            jar: request.jar()
        });

        return self.getSession()
            .then(sessionData => self.getTicket(sessionData, username, password))
            .then(self.getToken);
    };

    /**
     * Starts a session on the PTC website and returns a Promise that will be resolved with
     * the session parameters lt and execution.
     * @private
     * @return {Promise}
     */
    this.getSession = function() {
        return new Promise((resolve, reject) => {
            self.request({
                method: 'GET',
                url: 'https://sso.pokemon.com/sso/login',
                qs: {
                    service: 'https://sso.pokemon.com/sso/oauth2.0/callbackAuthorize'
                }
            }, (err, response, body) => {
                if (err) {
                    reject(Error(err));
                    return;
                }

                if (response.statusCode !== 200) {
                    reject(Error(`Status ${response.statusCode} received from PTC login`));
                    return;
                }

                var sessionResponse = JSON.parse(body);
                if (!sessionResponse || !sessionResponse.lt && !sessionResponse.execution) {
                    reject(Error('No session data received from PTC login'));
                    return;
                }

                resolve({
                    lt: sessionResponse.lt,
                    execution: sessionResponse.execution
                });
            });
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
        return new Promise((resolve, reject) => {
            self.request({
                method: 'POST',
                url: 'https://sso.pokemon.com/sso/login',
                qs: {
                    service: 'https://sso.pokemon.com/sso/oauth2.0/callbackAuthorize'
                },
                form: {
                    lt: sessionData.lt,
                    execution: sessionData.execution,
                    '_eventId': 'submit',
                    username: username,
                    password: password
                }
            }, (err, response) => {
                if (err) {
                    reject(Error(err));
                    return;
                }

                if (response.statusCode !== 302 || !response.headers.location) {
                    reject(Error('Invalid response received from PTC login'));
                    return;
                }

                var ticketURL = url.parse(response.headers.location, true);
                if (!ticketURL || !ticketURL.query.ticket) {
                    reject(Error('No login ticket received from PTC login'));
                    return;
                }

                resolve(ticketURL.query.ticket);
            });
        });
    };

    /**
     * Takes the login ticket from the PTC website and turns it into an auth token.
     * @private
     * @param {string} ticket - Login ticket from the {@link #getTicket} method
     * @return {Promise}
     */
    this.getToken = function(ticket) {
        return new Promise((resolve, reject) => {
            self.request({
                method: 'POST',
                url: 'https://sso.pokemon.com/sso/oauth2.0/accessToken',
                form: {
                    client_id: 'mobile-app_pokemon-go',
                    client_secret: 'w8ScCUXJQc6kXKw8FiOhd8Fixzht18Dq3PEVkUCP5ZPxtgyWsbTvWHFLm2wNY0JR',
                    redirect_uri: 'https://www.nianticlabs.com/pokemongo/error',
                    grant_type: 'refresh_token',
                    code: ticket
                }
            }, (err, response, body) => {
                if (err) {
                    reject(Error(err));
                    return;
                }

                if (response.statusCode !== 200) {
                    reject(Error(`Received status ${response.statusCode} from PTC OAuth`));
                    return;
                }

                var qs = querystring.parse(body);
                if (!qs || !qs.access_token) {
                    reject(Error('Invalid data received from PTC OAuth'));
                    return;
                }

                resolve(qs.access_token);
            });
        });
    };
}

module.exports = PTCLogin;