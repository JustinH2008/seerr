import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import TheMovieDb from '@server/api/themoviedb';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRemovalRequest } from '@server/entity/MediaRemovalRequest';
import { MediaRequest } from '@server/entity/MediaRequest';
import type { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { In } from 'typeorm';

export const REMOVAL_REQUEST_STATUSES = [
  MediaRequestStatus.APPROVED,
  MediaRequestStatus.COMPLETED,
];

export interface RemovalRequester {
  id: number;
  displayName: string;
  requestedRemoval: boolean;
}

export interface RemovalSummary {
  required: number;
  received: number;
  currentUserRequested: boolean;
  removed: boolean;
  requesters: RemovalRequester[];
}

export class NotARequesterError extends Error {
  constructor() {
    super('You can only request removal of a title you requested.');
    this.name = 'NotARequesterError';
  }
}

function summaryKey(mediaId: number, is4k: boolean): string {
  return `${mediaId}:${is4k ? 1 : 0}`;
}

function buildSummary(
  participants: User[],
  votedUserIds: Set<number>,
  userId: number | undefined,
  removed: boolean
): RemovalSummary {
  const requesters = participants.map((participant) => ({
    id: participant.id,
    displayName: participant.displayName,
    requestedRemoval: votedUserIds.has(participant.id),
  }));

  return {
    required: participants.length,
    received: requesters.filter((requester) => requester.requestedRemoval)
      .length,
    currentUserRequested: userId != null && votedUserIds.has(userId),
    removed,
    requesters,
  };
}

async function loadParticipants(
  mediaId: number,
  is4k: boolean
): Promise<User[]> {
  const requests = await getRepository(MediaRequest).find({
    where: {
      media: { id: mediaId },
      is4k,
      status: In(REMOVAL_REQUEST_STATUSES),
    },
    relations: { requestedBy: true },
  });

  const byId = new Map<number, User>();
  for (const request of requests) {
    if (request.requestedBy) {
      byId.set(request.requestedBy.id, request.requestedBy);
    }
  }
  return [...byId.values()];
}

async function loadVotes(
  mediaId: number,
  is4k: boolean
): Promise<MediaRemovalRequest[]> {
  return getRepository(MediaRemovalRequest).find({
    where: { media: { id: mediaId }, is4k },
    relations: { requestedBy: true },
  });
}

export async function getRemovalSummary(
  mediaId: number,
  is4k: boolean,
  userId?: number
): Promise<RemovalSummary> {
  const media = await getRepository(Media).findOne({ where: { id: mediaId } });
  if (!media) {
    throw new Error('Media not found');
  }

  const removed = media[is4k ? 'status4k' : 'status'] === MediaStatus.DELETED;
  const participants = await loadParticipants(mediaId, is4k);
  const votes = await loadVotes(mediaId, is4k);
  const votedUserIds = new Set(
    votes
      .map((vote) => vote.requestedBy?.id)
      .filter((id): id is number => id != null)
  );

  return buildSummary(participants, votedUserIds, userId, removed);
}

export async function getRemovalSummariesForRequests(
  items: { mediaId: number; is4k: boolean }[],
  userId: number
): Promise<Map<string, RemovalSummary>> {
  const summaries = new Map<string, RemovalSummary>();
  const unique = [
    ...new Map(
      items.map((item) => [summaryKey(item.mediaId, item.is4k), item])
    ).values(),
  ];

  await Promise.all(
    unique.map(async (item) => {
      const summary = await getRemovalSummary(item.mediaId, item.is4k, userId);
      if (summary.requesters.some((requester) => requester.id === userId)) {
        summaries.set(summaryKey(item.mediaId, item.is4k), summary);
      }
    })
  );

  return summaries;
}

export function removalSummaryKey(mediaId: number, is4k: boolean): string {
  return summaryKey(mediaId, is4k);
}

async function deleteVotes(
  mediaId: number,
  is4k: boolean,
  userId?: number
): Promise<void> {
  const query = getRepository(MediaRemovalRequest)
    .createQueryBuilder()
    .delete()
    .where('mediaId = :mediaId', { mediaId })
    .andWhere('is4k = :is4k', { is4k });

  if (userId != null) {
    query.andWhere('requestedById = :userId', { userId });
  }

  await query.execute();
}

async function recordVote(
  media: Media,
  user: User,
  is4k: boolean
): Promise<void> {
  const repository = getRepository(MediaRemovalRequest);
  const existing = await repository.findOne({
    where: {
      media: { id: media.id },
      requestedBy: { id: user.id },
      is4k,
    },
  });

  if (!existing) {
    await repository.save(
      new MediaRemovalRequest({
        media,
        requestedBy: user,
        is4k,
      })
    );
  }
}

export async function requestMediaRemoval(
  mediaId: number,
  user: User,
  is4k: boolean,
  removeFile: (media: Media, is4k: boolean) => Promise<void> = deleteMediaFiles
): Promise<RemovalSummary> {
  const mediaRepository = getRepository(Media);
  const media = await mediaRepository.findOne({ where: { id: mediaId } });
  if (!media) {
    throw new Error('Media not found');
  }

  const participants = await loadParticipants(mediaId, is4k);
  if (!participants.some((participant) => participant.id === user.id)) {
    throw new NotARequesterError();
  }

  if (media[is4k ? 'status4k' : 'status'] === MediaStatus.DELETED) {
    return getRemovalSummary(mediaId, is4k, user.id);
  }

  await recordVote(media, user, is4k);

  const votes = await loadVotes(mediaId, is4k);
  const votedUserIds = new Set(
    votes
      .map((vote) => vote.requestedBy?.id)
      .filter((id): id is number => id != null)
  );
  const everyoneAgreed =
    participants.length > 0 &&
    participants.every((participant) => votedUserIds.has(participant.id));

  if (everyoneAgreed) {
    await removeFile(media, is4k);
    await deleteVotes(media.id, is4k);
    const summary = await getRemovalSummary(mediaId, is4k, user.id);
    return { ...summary, removed: true };
  }

  return buildSummary(participants, votedUserIds, user.id, false);
}

export async function withdrawMediaRemoval(
  mediaId: number,
  user: User,
  is4k: boolean
): Promise<RemovalSummary> {
  const participants = await loadParticipants(mediaId, is4k);
  if (!participants.some((participant) => participant.id === user.id)) {
    throw new NotARequesterError();
  }

  await deleteVotes(mediaId, is4k, user.id);

  return getRemovalSummary(mediaId, is4k, user.id);
}

export async function deleteMediaFiles(
  media: Media,
  is4k: boolean
): Promise<void> {
  const settings = getSettings();
  const isMovie = media.mediaType === 'movie';

  let serviceSettings = (isMovie ? settings.radarr : settings.sonarr).find(
    (server) => server.isDefault && server.is4k === is4k
  );

  const specificServiceId = is4k ? media.serviceId4k : media.serviceId;
  if (
    specificServiceId != null &&
    specificServiceId >= 0 &&
    serviceSettings?.id !== specificServiceId
  ) {
    serviceSettings = (isMovie ? settings.radarr : settings.sonarr).find(
      (server) => server.id === specificServiceId
    );
  }

  if (!serviceSettings) {
    const arrName = `${is4k ? '4K ' : ''}${isMovie ? 'Radarr' : 'Sonarr'}`;
    logger.info(
      `There is no default ${arrName} server configured. Did you set any of your ${arrName} servers as default?`,
      {
        label: 'Media Request',
        mediaId: media.id,
      }
    );
    throw new Error(`No ${arrName} server configured to delete media files`);
  }

  if (isMovie) {
    const service = new RadarrAPI({
      apiKey: serviceSettings.apiKey,
      url: RadarrAPI.buildUrl(serviceSettings, '/api/v3'),
    });
    await service.removeMovie(media.tmdbId);
  } else {
    const tmdb = new TheMovieDb();
    const series = await tmdb.getTvShow({ tvId: media.tmdbId });
    const tvdbId = series.external_ids.tvdb_id ?? media.tvdbId;
    if (!tvdbId) {
      throw new Error('TVDB ID not found');
    }
    const service = new SonarrAPI({
      apiKey: serviceSettings.apiKey,
      url: SonarrAPI.buildUrl(serviceSettings, '/api/v3'),
    });
    await service.removeSeries(tvdbId);

    for (const season of media.seasons ?? []) {
      season[is4k ? 'status4k' : 'status'] = MediaStatus.DELETED;
    }
  }

  media[is4k ? 'status4k' : 'status'] = MediaStatus.DELETED;
  media.resetServiceData(is4k);
  await getRepository(Media).save(media);
  await deleteVotes(media.id, is4k);
}
