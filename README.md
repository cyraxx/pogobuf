# pogobuf, a Pokémon Go Client Library for node.js
[![npm version](https://badge.fury.io/js/pogobuf.svg)](https://badge.fury.io/js/pogobuf)
![npm downloads](https://img.shields.io/npm/dt/pogobuf.svg)
![dependencies](https://david-dm.org/cyraxx/pogobuf.svg)
![license](https://img.shields.io/npm/l/pogobuf.svg)
[![slack](https://pogobufslack.herokuapp.com/badge.svg)](https://pogobufslack.herokuapp.com/)

## Features
* Implements all known Pokémon Go API calls
* Includes native request signing (up to API version 0.45) and [hashing server support](https://github.com/cyraxx/pogobuf/wiki/Using-a-hashing-server) (API version 0.51 and up)
* Uses ES6 Promises and [Bluebird](https://github.com/petkaantonov/bluebird/)
* Includes [Pokémon Trainer Club](https://www.pokemon.com/en/pokemon-trainer-club) and Google login clients
* Optional batch mode to group several requests in one RPC call
* Automatically retries failed API requests with increasing delay
* 100% pure JS, no native library bindings

## Acknowledgements
* Uses the excellent [POGOProtos](https://github.com/AeonLucid/POGOProtos) (via [node-pogo-protos](https://github.com/cyraxx/node-pogo-protos))
* Based on prior work by [tejado](https://github.com/tejado/pgoapi) and others
* Uses [node-pogo-signature](https://github.com/SpencerSharkey/node-pogo-signature) for pure JS request signing

# Documentation and usage
You can find the documentation and other information in the [wiki](https://github.com/cyraxx/pogobuf/wiki).
