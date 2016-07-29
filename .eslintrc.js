module.exports = {
    "root": true,
    "extends": "eslint",
    "env": {
        "es6": true,
        "browser": false,
        "node": true
    },
    "rules": {
        "indent": [2, 4, {
            "SwitchCase": 1
        }],
        "quotes": [2, "single"],
        "valid-jsdoc": [2, {
            "requireReturn": false,
            "requireParamDescription": false,
            "requireReturnDescription": false
        }],
        "no-shadow": 1,
        "curly": [2, "multi-line"],
        "no-use-before-define": 1,
        "eol-last": 0,
        "max-len": [1, {
            "tabWidth": 4,
            "code": 120,
            "comments": 100
        }]
    }
};