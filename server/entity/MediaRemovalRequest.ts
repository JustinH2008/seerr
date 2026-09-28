import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import Media from './Media';
import { User } from './User';

@Entity()
@Unique('UQ_MEDIA_REMOVAL_USER', ['media', 'requestedBy', 'is4k'])
export class MediaRemovalRequest {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ default: false })
  public is4k: boolean;

  @ManyToOne(() => Media, { onDelete: 'CASCADE' })
  @Index()
  public media: Media;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @Index()
  public requestedBy: User;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  constructor(init?: Partial<MediaRemovalRequest>) {
    Object.assign(this, init);
  }
}
