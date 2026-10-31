export const DEFAULT_PICKUP_POINT_NAME = "甲方自提地址";
export const DEFAULT_PICKUP_ADDRESS = "与卖家确认";

export type PickupPointSource = {
  id: number;
  name: string;
  address: string;
  contactName: string;
  contactPhone: string;
  businessHours: string | null;
};

export type FlexiblePickupDetails = {
  method: "pickup";
  receiver: string;
  phone: string;
  address: string;
  pickupPoint: {
    id: number | null;
    name: string;
    address: string;
    contactName: string;
    contactPhone: string;
    businessHours: string | null;
  };
};

export function resolveFlexiblePickupDetails(input: {
  contactName?: string;
  contactPhone?: string;
  pickupPoint?: PickupPointSource;
}): FlexiblePickupDetails | null {
  const contactName = input.contactName?.trim() || "";
  const contactPhone = input.contactPhone?.trim() || "";
  if (!contactName || !/^[0-9+()\-\s]{6,20}$/.test(contactPhone)) return null;

  const pickupPoint = input.pickupPoint;
  const pickupAddress = pickupPoint?.address.trim() || DEFAULT_PICKUP_ADDRESS;
  return {
    method: "pickup",
    receiver: contactName,
    phone: contactPhone,
    address: pickupAddress,
    pickupPoint: {
      id: pickupPoint?.id ?? null,
      name: pickupPoint?.name.trim() || DEFAULT_PICKUP_POINT_NAME,
      address: pickupAddress,
      contactName: pickupPoint?.contactName.trim() || contactName,
      contactPhone: pickupPoint?.contactPhone.trim() || contactPhone,
      businessHours: pickupPoint?.businessHours?.trim() || null,
    },
  };
}
