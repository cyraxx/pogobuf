'use strict';

const pogobuf = require('../pogobuf/pogobuf.js');

//login types are ptc and google
var client = new pogobuf.Client('loginType','username','password');

client.init()
    .then(function(data){

    });
