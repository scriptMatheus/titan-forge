const rateLimit = require("express-rate-limit");

function isPremium(req) {
    
    let listaIpPremium = [
        "127.0.0.1"
    ];

    let ip = req.ip;

    if (typeof ip === 'string' && ip.startsWith('::ffff:')) {
      ip = ip.replace('::ffff:', '');
    }

    if (listaIpPremium.includes(ip)) {
        return true;
    } else {
        return false;
    }
}

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    message: "Limite atingido, tente novamente mais tarde. ⏳",
    max: function(req, res) {
      if (isPremium(req)) {
        return 100000;
      }
      return 100;
    }
  });

  const limiterReached = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 1,
    message: "Devagar, amigo. Você está solicitando rápido demais. 💥"
  });

  exports.limiterApiRequestsInvalid =(req, res, next) => {
    limiterReached(req, res, next);
  }
  
  exports.limiterApiRequests =(req, res, next) => {
    limiter(req, res, next);
  }

  exports.limiterApiRequestsInvalid =(req, res, next) => {
    limiterReached(req, res, next);
  }

