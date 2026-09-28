import type { MediaType } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties, PaginatedResponse } from './common';

export interface RequestResultsResponse extends PaginatedResponse {
  results: (NonFunctionProperties<MediaRequest> & {
    profileName?: string;
    canRemove?: boolean;
    removal?: {
      required: number;
      received: number;
      currentUserRequested: boolean;
      removed: boolean;
    } | null;
  })[];
  serviceErrors: {
    radarr: { id: number; name: string }[];
    sonarr: { id: number; name: string }[];
  };
}

export type MediaRequestBody = {
  mediaType: MediaType;
  mediaId: number;
  tvdbId?: number;
  seasons?: number[] | 'all';
  is4k?: boolean;
  serverId?: number;
  profileId?: number;
  profileName?: string;
  rootFolder?: string;
  languageProfileId?: number;
  userId?: number;
  tags?: number[];
  ignoreQuota?: boolean;
};
