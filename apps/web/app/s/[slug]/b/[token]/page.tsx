import { Ticket } from './Ticket';

export const metadata = { title: 'QR การจอง' };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <Ticket token={token} />;
}
