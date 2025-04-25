const axios = require("axios");
const { AuthenticationClient, Scopes } = require("@aps_sdk/authentication");
const { OssClient, Region, PolicyKey } = require("@aps_sdk/oss");
const { ModelDerivativeClient, View, OutputType } = require("@aps_sdk/model-derivative");
const { APS_CLIENT_ID, APS_CLIENT_SECRET, APS_BUCKET } = require("../config.js");

const authenticationClient = new AuthenticationClient();
const ossClient = new OssClient();
const modelDerivativeClient = new ModelDerivativeClient();

const service = (module.exports = {});

/**
 * 生成内部使用的访问令牌（为我们提供对数据管理存储桶和对象的读/写入访问
 * @returns
 */
async function getInternalToken() {
  const credentials = await authenticationClient.getTwoLeggedToken(
    APS_CLIENT_ID,
    APS_CLIENT_SECRET,
    [Scopes.DataRead, Scopes.DataCreate, Scopes.DataWrite, Scopes.BucketCreate, Scopes.BucketRead]
  );
  return credentials.access_token;
}

/**
 * 用于公共使用的令牌（只能从模型导数服务中读取对转换输出的读取访问）
 */
service.getViewerToken = async () => {
  return await authenticationClient.getTwoLeggedToken(APS_CLIENT_ID, APS_CLIENT_SECRET, [
    Scopes.ViewablesRead,
  ]);
};

/**
 * 确保存储桶存在, 如果不存在(即404) 会去创建一个
 * 这个存储桶名称要求在全球范围统一
 * @param {string} bucketKey
 */
service.ensureBucketExists = async (bucketKey) => {
  const accessToken = await getInternalToken();
  try {
    await ossClient.getBucketDetails(bucketKey, { accessToken });
  } catch (err) {
    if (err.axiosError.response.status === 404) {
      await ossClient.createBucket(
        Region.Us,
        { bucketKey: bucketKey, policyKey: PolicyKey.Persistent },
        { accessToken }
      );
    } else {
      throw err;
    }
  }
};

/**
 * 列出存储桶文件, 使用分页
 * @returns
 */
service.listObjects = async () => {
  await service.ensureBucketExists(APS_BUCKET);
  const accessToken = await getInternalToken();
  let resp = await ossClient.getObjects(APS_BUCKET, { limit: 64, accessToken });
  let objects = resp.items;
  while (resp.next) {
    const startAt = new URL(resp.next).searchParams.get("startAt");
    resp = await ossClient.getObjects(APS_BUCKET, { limit: 64, startAt, accessToken });
    objects = objects.concat(resp.items);
  }
  return objects;
};

service.uploadObject = async (objectName, filePath) => {
  await service.ensureBucketExists(APS_BUCKET);
  const accessToken = await getInternalToken();

  // 先尝试删除旧版本
  try {
    await deleteObject(objectName);
  } catch (err) {
    // 忽略"文件不存在"错误
    if (err.response?.status !== 404) throw err;
  }

  // 上传新文件
  const obj = await ossClient.uploadObject(APS_BUCKET, objectName, filePath, { accessToken });
  return obj;
};

service.deleteObject = async (objectKey) => {
  await service.ensureBucketExists(APS_BUCKET); // 确保 bucket 存在
  const accessToken = await getInternalToken();

  try {
    const result = await ossClient.deleteObject(APS_BUCKET, objectKey, { accessToken });
    console.log(`已删除 object: ${objectKey}`);
    return result;
  } catch (err) {
    console.error("删除 object 失败:", err.response?.status, err.response?.data);
    throw err;
  }
};


/**
 * 删除指定 bucket 下的 object（v2 Endpoint）
 * @param {string} objectKey 要删除的 objectKey（文件名）
 */
/* async function deleteObject(objectKey) {
  const accessToken = await getInternalToken();
  const url = `https://developer.api.autodesk.com/oss/v2/buckets/${APS_BUCKET}/objects/${encodeURIComponent(
    objectKey
  )}`;
  try {
    const resp = await axios.delete(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    console.log(`删除成功: ${objectKey}`);
    return resp.data;
  } catch (err) {
    console.error(`删除失败:`, err.response?.status, err.response?.data);
    throw err;
  }
} */

service.translateObject = async (urn, rootFilename) => {
  const accessToken = await getInternalToken();
  const job = await modelDerivativeClient.startJob(
    {
      input: {
        urn,
        compressedUrn: !!rootFilename,
        rootFilename,
      },
      output: {
        formats: [
          {
            views: [View._2d, View._3d],
            type: OutputType.Svf2,
          },
        ],
      },
    },
    { accessToken }
  );
  return job.result;
};

service.getManifest = async (urn) => {
  const accessToken = await getInternalToken();
  try {
    const manifest = await modelDerivativeClient.getManifest(urn, { accessToken });
    return manifest;
  } catch (err) {
    console.log(err);
    if (err.axiosError.response.status === 404) {
      return null;
    } else {
      throw err;
    }
  }
};

/**
 * 删除指定模型 URN 的转换衍生文件（包括 SVF）
 * @param {string} urn 模型的 Base64 编码 URN
 */
service.deleteDerivativeFiles = async (urn) => {
  const accessToken = await getInternalToken();
  try {
    // 调用 Model Derivative API 删除 Manifest 及其衍生文件
    await modelDerivativeClient.deleteManifest(urn, { accessToken });
    console.log(`已删除 URN 为 ${urn} 的衍生文件`);
    return true;
  } catch (err) {
    if (err.axiosError.response.status === 404) {
      console.log(`未找到 URN 为 ${urn} 的衍生文件`);
      return false;
    } else {
      throw err;
    }
  }
};

service.urnify = (id) => Buffer.from(id).toString("base64").replace(/=/g, "");

// (async () => {
//   let res = await deleteObject("阿壳案例-平面家装-170m2.dwg");
//   console.log(res);
//   let urn =
//     "dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6Zmxka2tmYWJ4dmJrM2V5a2twMmR6enRjYThrbTR4N3BkdW9zeXlvZGJiamJ2aXRpLWJhc2ljLWFwcC8lRTklOTglQkYlRTUlQTMlQjMlRTYlQTElODglRTQlQkUlOEItJUU1JUI5JUIzJUU5JTlEJUEyJUU1JUFFJUI2JUU4JUEzJTg1LTE3MG0yLmR3Zw";

//   service.deleteDerivativeFiles(urn);
// })();
