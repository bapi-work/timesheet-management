import toast from 'react-hot-toast';
import api from './api';

// Uploaded documents require sign-in, so they're fetched with the session token rather than linked directly
export async function openAttachment(url: string): Promise<void> {
  if (/^https?:\/\//i.test(url)) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  if (!url.startsWith('/uploads/')) return;

  try {
    const { data } = await api.get(`/files/${url.slice('/uploads/'.length)}`, { responseType: 'blob' });
    const objectUrl = URL.createObjectURL(data);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = url.split('/').pop() || 'attachment';
    link.click();
    URL.revokeObjectURL(objectUrl);
  } catch {
    toast.error('Could not open this file');
  }
}
