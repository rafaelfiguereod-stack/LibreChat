const fs = require('fs').promises;
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { logger } = require('@librechat/data-schemas');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const { resizeAvatar } = require('~/server/services/Files/images/avatar');
const { getFileStrategy } = require('~/server/utils/getFileStrategy');
const { filterFile } = require('~/server/services/Files/process');

const router = express.Router();

const avatarUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/', avatarUploadLimiter, async (req, res) => {
  let safeUploadPath;
  try {
    const appConfig = req.config;
    filterFile({ req, file: req.file, image: true, isAvatar: true });
    const userId = req.user.id;
    const { manual } = req.body;

    if (!req.file || typeof req.file.path !== 'string') {
      throw new Error('Uploaded file path is invalid');
    }

    const configuredUploadRoot = appConfig?.paths?.upload?.temp || appConfig?.paths?.uploads;
    if (typeof configuredUploadRoot !== 'string' || configuredUploadRoot.length === 0) {
      throw new Error('Upload root directory is not configured');
    }
    const uploadRootDir = await fs.realpath(path.resolve(configuredUploadRoot));
    const uploadedFileName = path.basename(req.file.path);
    const uploadCandidatePath = path.resolve(uploadRootDir, uploadedFileName);
    safeUploadPath = await fs.realpath(uploadCandidatePath);
    if (
      safeUploadPath !== uploadRootDir &&
      !safeUploadPath.startsWith(uploadRootDir + path.sep)
    ) {
      throw new Error('Invalid upload path');
    }

    const input = await fs.readFile(safeUploadPath);

    if (!userId) {
      throw new Error('User ID is undefined');
    }

    const fileStrategy = getFileStrategy(appConfig, { isAvatar: true });
    const desiredFormat = appConfig.imageOutputType;
    const resizedBuffer = await resizeAvatar({
      userId,
      input,
      desiredFormat,
    });

    const { processAvatar } = getStrategyFunctions(fileStrategy);
    const url = await processAvatar({ buffer: resizedBuffer, userId, manual });

    res.json({ url });
  } catch (error) {
    const message = 'An error occurred while uploading the profile picture';
    logger.error(message, error);
    res.status(500).json({ message });
  } finally {
    try {
      if (safeUploadPath) {
        await fs.unlink(safeUploadPath);
        logger.debug('[/files/images/avatar] Temp. image upload file deleted');
      }
    } catch {
      logger.debug('[/files/images/avatar] Temp. image upload file already deleted');
    }
  }
});

module.exports = router;
