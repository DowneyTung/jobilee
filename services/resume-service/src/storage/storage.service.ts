import { randomUUID } from "node:crypto";
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Logger } from "@jobilee/logger";
import { CONFIG, LOGGER } from "@jobilee/service-kit";
import type { Config } from "../config.ts";

@Injectable()
export class StorageService implements OnModuleInit {
  /** Talks to MinIO over the compose network. */
  private readonly internal: S3Client;
  /**
   * Identical credentials, but pointed at the browser-facing host. Only ever
   * used to sign URLs — never to move bytes.
   */
  private readonly publicSigner: S3Client;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly log: Logger,
  ) {
    const credentials = {
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY,
    };
    const shared = {
      region: config.S3_REGION,
      credentials,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
    };
    this.internal = new S3Client({ ...shared, endpoint: config.S3_ENDPOINT });
    this.publicSigner = new S3Client({ ...shared, endpoint: config.S3_PUBLIC_ENDPOINT });
  }

  /** The bucket is created by compose, but a fresh volume shouldn't 500. */
  async onModuleInit(): Promise<void> {
    try {
      await this.internal.send(new HeadBucketCommand({ Bucket: this.config.S3_BUCKET }));
    } catch {
      try {
        await this.internal.send(new CreateBucketCommand({ Bucket: this.config.S3_BUCKET }));
        this.log.info("created missing bucket", { bucket: this.config.S3_BUCKET });
      } catch (error) {
        // Not fatal: object storage may simply not be up yet, and /ready reports it.
        this.log.warn("could not verify bucket", { bucket: this.config.S3_BUCKET, err: error });
      }
    }
  }

  /**
   * Keys are namespaced by user and carry a random component, so one user can
   * never guess or collide with another's object — and the original filename
   * never becomes part of the path.
   */
  buildObjectKey(userId: string, filename: string): string {
    const extension = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
    return `u/${userId}/${randomUUID()}${extension.toLowerCase()}`;
  }

  async put(objectKey: string, body: Buffer, contentType: string): Promise<void> {
    await this.internal.send(
      new PutObjectCommand({
        Bucket: this.config.S3_BUCKET,
        Key: objectKey,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async remove(objectKey: string): Promise<void> {
    await this.internal.send(
      new DeleteObjectCommand({ Bucket: this.config.S3_BUCKET, Key: objectKey }),
    );
  }

  /**
   * Short-lived download URL. `filename` is echoed back as a Content-Disposition
   * override so the browser saves it under the name the user uploaded.
   */
  async signedDownloadUrl(
    objectKey: string,
    filename: string,
  ): Promise<{ url: string; expiresAt: Date }> {
    const command = new GetObjectCommand({
      Bucket: this.config.S3_BUCKET,
      Key: objectKey,
      ResponseContentDisposition: `attachment; filename="${filename.replace(/"/g, "")}"`,
    });
    const url = await getSignedUrl(this.publicSigner, command, {
      expiresIn: this.config.S3_SIGNED_URL_TTL,
    });
    return { url, expiresAt: new Date(Date.now() + this.config.S3_SIGNED_URL_TTL * 1000) };
  }

  async isReachable(): Promise<boolean> {
    try {
      await this.internal.send(new HeadBucketCommand({ Bucket: this.config.S3_BUCKET }));
      return true;
    } catch {
      return false;
    }
  }
}
