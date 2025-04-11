const express = require('express');
const { getViewerToken } = require('../services/aps.js');

let router = express.Router();

// 生成公共使用的token
router.get('/api/auth/token', async function (req, res, next) {
    try {
        res.json(await getViewerToken());
    } catch (err) {
        next(err);
    }
});

module.exports = router;