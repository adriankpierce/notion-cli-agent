/**
 * File command - upload files to Notion pages
 */
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { getClient } from '../client.js';
import { formatOutput } from '../utils/format.js';
import { withErrorHandler } from '../utils/command-handler.js';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.tiff', '.heic', '.avif', '.bmp', '.ico']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi', '.flv', '.3gp', '.mpeg', '.ogv']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.midi']);
const PDF_EXTS = new Set(['.pdf']);

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.tiff': 'image/tiff', '.heic': 'image/heic', '.avif': 'image/avif',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.pdf': 'application/pdf',
  '.json': 'application/json', '.csv': 'text/csv',
  '.txt': 'text/plain', '.md': 'text/markdown',
  '.html': 'text/html', '.xml': 'application/xml',
  '.zip': 'application/zip', '.gz': 'application/gzip',
};

function detectBlockType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (PDF_EXTS.has(ext)) return 'pdf';
  return 'file';
}

function buildFileBlock(
  blockType: string,
  fileUploadId: string,
  caption?: string,
): Record<string, unknown> {
  const fileRef = {
    type: 'file_upload',
    file_upload: { id: fileUploadId },
    caption: caption
      ? [{ type: 'text', text: { content: caption } }]
      : [],
  };

  return {
    object: 'block',
    type: blockType,
    [blockType]: fileRef,
  };
}

export function registerFileCommand(program: Command): void {
  const file = program
    .command('file')
    .description('Upload files to Notion pages');

  file
    .command('upload <page_id> [file_path]')
    .description('Upload a file and attach it to a page')
    .option('--url <url>', 'Import from external URL instead of local file')
    .option('--caption <text>', 'Caption for the file')
    .option('--position <pos>', 'Where to attach: top or bottom', 'bottom')
    .option('-j, --json', 'Output raw JSON')
    .action(withErrorHandler(async (pageId: string, filePath: string | undefined, options) => {
      const client = getClient();

      if (!filePath && !options.url) {
        console.error('Error: Provide a file path or --url');
        process.exit(1);
      }

      if (filePath && options.url) {
        console.error('Error: Provide either a file path or --url, not both');
        process.exit(1);
      }

      let fileUploadId: string;
      let filename: string;

      if (options.url) {
        // External URL mode — Notion fetches the file asynchronously
        filename = path.basename(new URL(options.url).pathname) || 'file';
        const upload = await client.post<{ id: string; status: string }>('file_uploads', {
          mode: 'external_url',
          external_url: options.url,
          filename,
        });
        fileUploadId = upload.id;

        // Poll until Notion finishes importing the file
        console.error('Importing from URL...');
        for (let i = 0; i < 30; i++) {
          const status = await client.get<{ status: string }>(`file_uploads/${fileUploadId}`);
          if (status.status === 'uploaded') break;
          if (status.status === 'failed') {
            console.error('Error: Notion failed to import the file from the URL');
            process.exit(1);
          }
          await new Promise(r => setTimeout(r, 1000));
        }
      } else {
        // Local file upload
        const resolvedPath = path.resolve(filePath!);
        if (!fs.existsSync(resolvedPath)) {
          console.error(`Error: File not found: ${resolvedPath}`);
          process.exit(1);
        }

        filename = path.basename(resolvedPath);
        const fileBuffer = fs.readFileSync(resolvedPath);

        // Step 1: Create file upload
        const upload = await client.post<{ id: string }>('file_uploads', {
          mode: 'single_part',
        });

        // Step 2: Send the binary with correct MIME type
        const ext = path.extname(filename).toLowerCase();
        const contentType = MIME_TYPES[ext];
        await client.sendFile(`file_uploads/${upload.id}/send`, fileBuffer, filename, contentType);
        fileUploadId = upload.id;
      }

      // Step 3: Attach to page as a block
      const blockType = detectBlockType(filename);
      const block = buildFileBlock(blockType, fileUploadId, options.caption);

      // For top position, get first block and insert before it
      let body: Record<string, unknown> = { children: [block] };
      if (options.position === 'top') {
        const existing = await client.get<{ results: { id: string }[] }>(
          `blocks/${pageId}/children`,
          { page_size: 1 },
        );
        if (existing.results.length > 0) {
          body = {
            children: [block],
            position: { before_block: existing.results[0].id },
          };
        }
      }

      const result = await client.patch(`blocks/${pageId}/children`, body);

      if (options.json) {
        console.log(formatOutput(result));
      } else {
        console.log(`Uploaded ${filename} as ${blockType} block`);
        console.log(`   File upload ID: ${fileUploadId}`);
      }
    }));
}
