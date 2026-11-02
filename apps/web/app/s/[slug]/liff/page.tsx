import { Suspense } from 'react';
import { LiffFlow } from './LiffFlow';

export const metadata = { title: 'ยืนยันการจอง' };

export default function Page() {
  return (
    <Suspense>
      <LiffFlow />
    </Suspense>
  );
}
