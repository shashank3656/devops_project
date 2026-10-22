export function requestPriorityName(value?: string): string {
  switch ((value || '').trim().toLowerCase()) {
    case 'low':
    case 'l1':
    case 'p4':
      return 'Low';
    case 'high':
    case 'l3':
    case 'p2':
      return 'High';
    case 'critical':
    case 'l4':
    case 'p1':
      return 'Critical';
    case 'medium':
    case 'l2':
    case 'p3':
      return 'Medium';
    default: {
      const text = (value || '').trim();
      if (!text) return 'Medium';
      return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    }
  }
}

export function approvalLevel(value?: string): string {
  switch (requestPriorityName(value)) {
    case 'Low':
      return 'L1';
    case 'High':
      return 'L3';
    case 'Critical':
      return 'L4';
    default:
      return 'L2';
  }
}

export function priorityTone(value?: string): string {
  return requestPriorityName(value).toLowerCase();
}
