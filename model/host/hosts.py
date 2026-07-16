from datetime import datetime

from sqlmodel import Field, SQLModel


class ManagedHost(SQLModel, table=True):
    __tablename__ = "managed_hosts"

    id: int | None = Field(default=None, primary_key=True)
    display_name: str = Field(default="")
    ip_address: str = Field(default="", index=True)
    ssh_port: int = Field(default=22)
    host_account: str = Field(default="")
    host_password: str = Field(default="")
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
