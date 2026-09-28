import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import ExternalAPI from '@server/api/externalapi';
import { MediaRequestStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import {
  NotARequesterError,
  requestMediaRemoval,
  withdrawMediaRemoval,
} from '@server/lib/mediaRemoval';
import { Permission } from '@server/lib/permissions';
import { setupTestDb } from '@server/test/db';

mock.method(
  ExternalAPI.prototype as unknown as {
    get: (endpoint: string) => Promise<unknown>;
  },
  'get',
  async (endpoint: string) => {
    const tmdbId = Number(endpoint.replace(/^\/(movie|tv)\//, ''));
    if (!tmdbId) {
      throw new Error(`Unstubbed external endpoint: ${endpoint}`);
    }
    return {
      id: tmdbId,
      external_ids: { tvdb_id: tmdbId },
      seasons: [],
      videos: { results: [] },
    };
  }
);

setupTestDb();

async function createUser(email: string): Promise<User> {
  return getRepository(User).save(
    new User({
      email,
      permissions: Permission.REQUEST,
      avatar: '',
      username: email.split('@')[0],
    })
  );
}

async function createApprovedRequest(
  media: Media,
  user: User,
  is4k = false
): Promise<void> {
  await getRepository(MediaRequest).save(
    new MediaRequest({
      status: MediaRequestStatus.APPROVED,
      type: MediaType.MOVIE,
      media,
      requestedBy: user,
      is4k,
    })
  );
}

describe('requestMediaRemoval', () => {
  it('removes immediately when the only requester asks', async () => {
    const owner = await createUser('only@seerr.dev');
    const media = await getRepository(Media).save(
      new Media({ tmdbId: 910001, mediaType: MediaType.MOVIE })
    );
    await createApprovedRequest(media, owner);

    let removals = 0;
    const summary = await requestMediaRemoval(
      media.id,
      owner,
      false,
      async () => {
        removals += 1;
      }
    );

    assert.equal(removals, 1);
    assert.equal(summary.removed, true);
    assert.equal(summary.required, 1);
  });

  it('waits until every requester has asked', async () => {
    const first = await createUser('first@seerr.dev');
    const second = await createUser('second@seerr.dev');
    const outsider = await createUser('outsider@seerr.dev');
    const media = await getRepository(Media).save(
      new Media({ tmdbId: 910002, mediaType: MediaType.MOVIE })
    );
    await createApprovedRequest(media, first);
    await createApprovedRequest(media, second);
    await getRepository(MediaRequest).save(
      new MediaRequest({
        status: MediaRequestStatus.DECLINED,
        type: MediaType.MOVIE,
        media,
        requestedBy: outsider,
        is4k: false,
      })
    );

    let removals = 0;
    const removeFile = async () => {
      removals += 1;
    };

    const waiting = await requestMediaRemoval(
      media.id,
      first,
      false,
      removeFile
    );
    assert.equal(removals, 0);
    assert.equal(waiting.removed, false);
    assert.equal(waiting.required, 2);
    assert.equal(waiting.received, 1);
    assert.equal(waiting.currentUserRequested, true);

    await assert.rejects(
      () => requestMediaRemoval(media.id, outsider, false, removeFile),
      NotARequesterError
    );

    const done = await requestMediaRemoval(media.id, second, false, removeFile);
    assert.equal(removals, 1);
    assert.equal(done.removed, true);
    assert.equal(done.received, 0);
  });

  it('does not count a withdrawn request toward agreement', async () => {
    const first = await createUser('withdraw-a@seerr.dev');
    const second = await createUser('withdraw-b@seerr.dev');
    const media = await getRepository(Media).save(
      new Media({ tmdbId: 910003, mediaType: MediaType.MOVIE })
    );
    await createApprovedRequest(media, first);
    await createApprovedRequest(media, second);

    let removals = 0;
    const removeFile = async () => {
      removals += 1;
    };

    await requestMediaRemoval(media.id, first, false, removeFile);
    const withdrawn = await withdrawMediaRemoval(media.id, first, false);
    assert.equal(withdrawn.currentUserRequested, false);
    assert.equal(withdrawn.received, 0);

    const stillWaiting = await requestMediaRemoval(
      media.id,
      second,
      false,
      removeFile
    );
    assert.equal(removals, 0);
    assert.equal(stillWaiting.required, 2);
    assert.equal(stillWaiting.received, 1);
  });

  it('keeps 4K agreement separate from the standard copy', async () => {
    const owner = await createUser('fourk@seerr.dev');
    const media = await getRepository(Media).save(
      new Media({ tmdbId: 910004, mediaType: MediaType.MOVIE })
    );
    await createApprovedRequest(media, owner, false);
    await createApprovedRequest(media, owner, true);

    let removals = 0;
    const summary = await requestMediaRemoval(
      media.id,
      owner,
      true,
      async (_media, is4k) => {
        removals += 1;
        assert.equal(is4k, true);
      }
    );

    assert.equal(removals, 1);
    assert.equal(summary.removed, true);

    const standard = await requestMediaRemoval(
      media.id,
      owner,
      false,
      async () => {
        removals += 1;
      }
    );
    assert.equal(standard.removed, true);
    assert.equal(removals, 2);
  });
});
