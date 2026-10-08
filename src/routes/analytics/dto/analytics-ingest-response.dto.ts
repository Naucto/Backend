import { ApiProperty } from '@nestjs/swagger';

/**
 * Tells the client to mint fresh ids. Each applies only to the id the request carried: a client
 * whose cookie already moved on ignores it.
 */
export class AnalyticsRotationDto {
  @ApiProperty({
    description: 'The visitor id is erased or expired: start a new visitor and session',
  })
  rotateVisitor!: boolean;

  @ApiProperty({ description: "The session is closed or not this visitor's: start a new session" })
  rotateSession!: boolean;

  @ApiProperty({ description: 'Analytics is off on this deployment: stop sending' })
  disabled!: boolean;
}

export class AnalyticsRejectedEventDto {
  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ enum: ['too_old'] })
  reason!: 'too_old';
}

export class AnalyticsEventsResponseDto extends AnalyticsRotationDto {
  @ApiProperty({
    type: [String],
    description: 'Events stored now or by an earlier attempt of the same batch',
  })
  accepted!: string[];

  @ApiProperty({ type: [AnalyticsRejectedEventDto] })
  rejected!: AnalyticsRejectedEventDto[];
}

export class AnalyticsPlayResponseDto extends AnalyticsRotationDto {
  @ApiProperty({
    enum: ['ok', 'ended', 'rejected'],
    description:
      "`ended`: the play is over and takes no more progress; `rejected`: not this session's play",
  })
  status!: 'ok' | 'ended' | 'rejected';
}

export class AnalyticsLinkResponseDto {
  @ApiProperty({
    enum: ['linked', 'conflict', 'erased', 'disabled'],
    description:
      '`conflict`: the visitor belongs to another account; `erased`: the visitor was erased or expired. Both mean: mint a new visitor and link that one. `disabled`: analytics is off.',
  })
  status!: 'linked' | 'conflict' | 'erased' | 'disabled';
}
