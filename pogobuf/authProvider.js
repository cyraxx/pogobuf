
'use strict';


const ptc = require('./pogobuf.ptclogin.js');
const google = require('./pogobuf.googlelogin.js');

/**
 * Google login client.
 * @class GoogleLogin
 * @memberof pogobuf
 */
function AuthProvider(type,user,pass) {
    if (!(this instanceof AuthProvider)) {
        return new AuthProvider();
    }
    const self = this;
  
    const authType = type;
    const username = user;
    const password = pass;

    var login = {};

    if (authType == 'ptc'){
        login = new ptc();
    }
    else {
        login = new google();
    }


    this.authenticate = function(){
        return new Promise((resolve, reject) => {
            login.login(username,password).then(function(token){
                resolve({authType: authType, token: token});
            },
            function(error){
                reject(Error(error));
            });
        });
    }

    
}

module.exports = AuthProvider;