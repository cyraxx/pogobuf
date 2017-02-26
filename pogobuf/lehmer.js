
function Random(seed) {
    this.multiplier = 16807;
    this.modulus = 0x7fffffff;
    this.seed = seed;
    this.mq = Math.floor(this.modulus / this.multiplier);
    this.mr = this.modulus % this.multiplier;
}

Random.prototype.nextInt = function() {
    var temp = this.multiplier * (this.seed % this.mq) - (this.mr * Math.floor(this.seed / this.mq));
    if (temp > 0) {
        this.seed = temp;
    } else {
        this.seed = temp + this.modulus;
    }
    return this.seed;
};

module.exports = Random;
