'use strict';

const GoogleOAuth = require('gpsoauthnode');
const google = new GoogleOAuth();

/**
 * Google login client.
 * @class GoogleLogin
 * @memberof pogobuf
 */
function GoogleLogin() {
    if (!(this instanceof GoogleLogin)) {
        return new GoogleLogin();
    }
    const self = this;

    /**
     * Based of https://github.com/tejado/pgoapi/blob/master/pgoapi/auth_google.py#L33
     */
    const GOOGLE_LOGIN_ANDROID_ID = '9774d56d682e549c';
    const GOOGLE_LOGIN_SERVICE =
        'audience:server:client_id:848232511240-7so421jotr2609rmqakceuu1luuq0ptb.apps.googleusercontent.com';
    const GOOGLE_LOGIN_APP = 'com.nianticlabs.pokemongo';
    const GOOGLE_LOGIN_CLIENT_SIG = '321187995bc7cdc2b5fc91b11a96e2baa8602c62';

    /**
     * Performs the Google Login using Android Device and returns a Promise that will be resolved
     * with the auth token.
     * @param {string} username
     * @param {string} password
     * @return {Promise}
     */
    this.login = function(username, password) {
        return self.getMasterToken(username, password).then((loginData) => {
            return self.getToken(username, loginData);
        }).then((authData) => {
            return authData.Auth;
        });
    };

    /**
     * Performs the Google login by skipping the password step and starting with the Master Token
     * instead. Returns a Promise that will be resolved with the auth token.
     * @param {string} username
     * @param {string} token
     * @return {Promise}
     */
    this.loginWithToken = function(username, token) {
        var loginData = {
            androidId: GOOGLE_LOGIN_ANDROID_ID,
            masterToken: token
        };
        return self.getToken(username, loginData).then((authData) => {
            return authData.Auth;
        });
    };

    /**
     * Initialize Google Login
     * @param {string} username
     * @param {string} password
     * @return {Promise}
     */
    this.getMasterToken = function(username, password) {
        return new Promise((resolve, reject) => {
            google.login(username, password, GOOGLE_LOGIN_ANDROID_ID, (err, data) => {
                if (err) {
                    if (err.response.statusCode === 403) {
                        reject(Error(
                            'Received code 403 from Google login. This could be because your account has ' +
                            '2-Step-Verification enabled. If that is the case, you need to generate an ' +
                            'App Password and use that instead of your regular password: ' +
                            'https://security.google.com/settings/security/apppasswords'
                        ));
                    } else {
                        reject(Error(err.response.statusCode + ': ' + err.response.statusMessage));
                    }
                    return;
                }

                resolve(data);
            });
        });
    };

    /**
     * Finalizes oAuth request using master token and resolved with the auth data
     * @private
     * @param {string} username
     * @param {string} loginData
     * @return {Promise}
     */
    this.getToken = function(username, loginData) {
        return new Promise((resolve, reject) => {
            google.oauth(username, loginData.masterToken, loginData.androidId,
                GOOGLE_LOGIN_SERVICE, GOOGLE_LOGIN_APP, GOOGLE_LOGIN_CLIENT_SIG, (err, data) => {
                    if (err) {
                        reject(Error(err.response.statusCode + ': ' + err.response.statusMessage));
                        return;
                    }

                    resolve(data);
                });
        });
    };
}

module.exports = GoogleLogin;