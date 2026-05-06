const path = require('path');
const fs = require('fs').promises;
const express = require('express');
const rateLimit = require('express-rate-limit');
const { logger } = require('@librechat/data-schemas');
const { verifyAgentUploadPermission, resolveUploadErrorMessage } = require('@librechat/api');
const { isAssistantsEndpoint } = require('librechat-data-provider');
const {
  processAgentFileUpload,
  processImageFile,
  filterFile,
} = require('~/server/services/Files/process');
const { checkPermission } = require('~/server/services/PermissionService');
const db = require('~/models');

const router = express.Router();

const imageUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/', imageUploadLimiter, async (req, res) => {
  const metadata = req.body;
  const appConfig = req.config;

  try {
    filterFile({ req, image: true });

    metadata.temp_file_id = metadata.file_id;
    metadata.file_id = req.file_id;

    if (!isAssistantsEndpoint(metadata.endpoint) && metadata.tool_resource != null) {
      const denied = await verifyAgentUploadPermission({
        req,
        res,
        metadata,
        getAgent: db.getAgent,
        checkPermission,
      });
      if (denied) {
        return;
      }
      return await processAgentFileUpload({ req, res, metadata });
    }

    await processImageFile({ req, res, metadata });
  } catch (error) {
    // TODO: delete remote file if it exists
    logger.error('[/files/images] Error processing file:', error);

    const message = resolveUploadErrorMessage(error);

    try {
      const filepath = path.join(
        appConfig.paths.imageOutput,
        req.user.id,
        path.basename(req.file.filename),
      );
      await fs.unlink(filepath);
    } catch (error) {
      logger.error('[/files/images] Error deleting file:', error);
    }
    res.status(500).json({ message });
  } finally {
    try {
      const uploadRoot = path.resolve(appConfig.paths.imageOutput, req.user.id);
      const candidatePath = path.resolve(req.file.path);
      const uploadRootWithSep = uploadRoot.endsWith(path.sep) ? uploadRoot : uploadRoot + path.sep;

      if (candidatePath.startsWith(uploadRootWithSep)) {
        await fs.unlink(candidatePath);
        logger.debug('[/files/images] Temp. image upload file deleted');
      } else {
        logger.warn('[/files/images] Skipping temp file deletion due to invalid path');
      }
    } catch {
      logger.debug('[/files/images] Temp. image upload file already deleted');
    }
  }
});

module.exports = router;
