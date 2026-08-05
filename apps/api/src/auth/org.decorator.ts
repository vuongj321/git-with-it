import { SetMetadata } from '@nestjs/common';

export const ORG_ID_PARAM_KEY = 'orgIdParam';
export const OrgIdParam = (param = 'orgId') => SetMetadata(ORG_ID_PARAM_KEY, param);
