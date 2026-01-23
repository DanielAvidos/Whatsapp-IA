import { ChannelDetailPage } from "@/components/app/channel-detail-page";

export default function ChannelDetail({ params }: { params: { channelId: string } }) {
  return <ChannelDetailPage channelId={params.channelId} />;
}
