const express = require("express");
const formidable = require("express-formidable");
const {
  listObjects,
  uploadObject,
  translateObject,
  getManifest,
  urnify,
} = require("../services/aps.js");

let router = express.Router();

// 获取所有可供查看的模型的列表
router.get("/api/models", async function (req, res, next) {
  try {
    const objects = await listObjects();
    res.json(
      objects.map((o) => ({
        name: o.objectKey,
        urn: urnify(o.objectId),
        o: o,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// 检查模型的转换状态（如果有的话，包括错误消息）
router.get("/api/models/:urn/status", async function (req, res, next) {
  try {
    const manifest = await getManifest(req.params.urn);
    if (manifest) {
      let messages = [];
      if (manifest.derivatives) {
        for (const derivative of manifest.derivatives) {
          messages = messages.concat(derivative.messages || []);
          if (derivative.children) {
            for (const child of derivative.children) {
              messages.concat(child.messages || []);
            }
          }
        }
      }
      res.json({ status: manifest.status, progress: manifest.progress, messages });
    } else {
      res.json({ status: "n/a" });
    }
  } catch (err) {
    next(err);
  }
});

// 上传新模型并开始转换
router.post("/api/models", formidable({ maxFileSize: Infinity }), async function (req, res, next) {
  const file = req.files["model-file"];
  if (!file) {
    res.status(400).send('The required field ("model-file") is missing.');
    return;
  }
  try {
    const obj = await uploadObject(file.name, file.path);
    console.log(obj);
    await translateObject(urnify(obj.objectId), req.fields["model-zip-entrypoint"]);
    res.json({
      name: obj.objectKey,
      urn: urnify(obj.objectId),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
