import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMediaRemovalRequest1790700000000 implements MigrationInterface {
  name = 'AddMediaRemovalRequest1790700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "media_removal_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "is4k" boolean NOT NULL DEFAULT (0), "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "mediaId" integer, "requestedById" integer, CONSTRAINT "UQ_MEDIA_REMOVAL_USER" UNIQUE ("mediaId", "requestedById", "is4k"), CONSTRAINT "FK_media_removal_media" FOREIGN KEY ("mediaId") REFERENCES "media" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_media_removal_user" FOREIGN KEY ("requestedById") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_media_removal_media" ON "media_removal_request" ("mediaId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_media_removal_user" ON "media_removal_request" ("requestedById")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_media_removal_user"`);
    await queryRunner.query(`DROP INDEX "IDX_media_removal_media"`);
    await queryRunner.query(`DROP TABLE "media_removal_request"`);
  }
}
