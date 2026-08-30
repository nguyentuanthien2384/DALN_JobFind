import React, { useState } from "react";

const SUPPORT_REPOSITORY =
  "https://github.com/nguyentuanthien2384/DALN_JobFind";

const initialForm = {
  name: "",
  email: "",
  subject: "",
  message: "",
};

const validateContact = (values, requireReplyDetails = true) => {
  const errors = {};

  if (requireReplyDetails) {
    if (!values.name.trim()) {
      errors.name = "Vui lòng nhập họ tên.";
    }

    if (!values.email.trim()) {
      errors.email = "Vui lòng nhập email.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
      errors.email = "Email chưa đúng định dạng.";
    }
  }

  if (!values.subject.trim()) {
    errors.subject = "Vui lòng nhập chủ đề.";
  }

  if (!values.message.trim()) {
    errors.message = "Vui lòng nhập nội dung cần hỗ trợ.";
  }

  return errors;
};

const createSupportDraftUrl = (values, contactEmail = "") => {
  const subject = `[JobFind] ${values.subject.trim()}`;
  if (contactEmail) {
    const body = [
      `Họ tên: ${values.name.trim()}`,
      `Email phản hồi: ${values.email.trim()}`,
      "",
      values.message.trim(),
    ].join("\n");

    return `mailto:${contactEmail}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(body)}`;
  }

  return `${SUPPORT_REPOSITORY}/issues/new?title=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(values.message.trim())}`;
};

const Contact = () => {
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [draftUrl, setDraftUrl] = useState("");
  const contactEmail = (process.env.REACT_APP_CONTACT_EMAIL || "").trim();

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setDraftUrl("");
    setErrors((current) => ({ ...current, [name]: undefined }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const validationErrors = validateContact(form, Boolean(contactEmail));
    setErrors(validationErrors);

    if (Object.keys(validationErrors).length === 0) {
      setDraftUrl(createSupportDraftUrl(form, contactEmail));
    }
  };

  const renderError = (field) =>
    errors[field] ? (
      <p className="text-danger mt-1" id={`${field}-error`} role="alert">
        {errors[field]}
      </p>
    ) : null;

  return (
    <main>
      <div className="slider-area">
        <div
          className="single-slider section-overly slider-height2 d-flex align-items-center"
          style={{ backgroundImage: 'url("assets/img/hero/about.jpg")' }}
        >
          <div className="container">
            <div className="row">
              <div className="col-xl-12">
                <div className="hero-cap text-center">
                  <h2>Liên hệ JobFind</h2>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <section className="contact-section" aria-labelledby="contact-title">
        <div className="container">
          <div className="row">
            <div className="col-12">
              <h2 className="contact-title" id="contact-title">
                Yêu cầu hỗ trợ
              </h2>
              <p>
                {contactEmail
                  ? "Mô tả vấn đề bạn gặp phải. JobFind sẽ chuẩn bị một email để bạn kiểm tra trước khi gửi."
                  : "Mô tả lỗi kỹ thuật bạn gặp phải. JobFind sẽ chuẩn bị một yêu cầu công khai trên GitHub để bạn kiểm tra trước khi gửi."}
              </p>
            </div>

            <div className="col-lg-8">
              <form
                className="form-contact contact_form"
                id="contactForm"
                noValidate
                onSubmit={handleSubmit}
              >
                <div className="row">
                  <div className="col-12">
                    <div className="form-group">
                      <label htmlFor="message">Nội dung</label>
                      <textarea
                        className="form-control w-100"
                        name="message"
                        id="message"
                        cols="30"
                        rows="9"
                        placeholder="Mô tả chi tiết vấn đề cần hỗ trợ"
                        value={form.message}
                        onChange={handleChange}
                        aria-invalid={Boolean(errors.message)}
                        aria-describedby={errors.message ? "message-error" : undefined}
                        required
                      />
                      {renderError("message")}
                    </div>
                  </div>

                  {contactEmail && (
                    <>
                      <div className="col-sm-6">
                        <div className="form-group">
                          <label htmlFor="name">Họ tên</label>
                          <input
                            className="form-control"
                            name="name"
                            id="name"
                            type="text"
                            placeholder="Họ tên của bạn"
                            value={form.name}
                            onChange={handleChange}
                            aria-invalid={Boolean(errors.name)}
                            aria-describedby={errors.name ? "name-error" : undefined}
                            required
                          />
                          {renderError("name")}
                        </div>
                      </div>

                      <div className="col-sm-6">
                        <div className="form-group">
                          <label htmlFor="email">Email phản hồi</label>
                          <input
                            className="form-control"
                            name="email"
                            id="email"
                            type="email"
                            placeholder="you@example.com"
                            value={form.email}
                            onChange={handleChange}
                            aria-invalid={Boolean(errors.email)}
                            aria-describedby={errors.email ? "email-error" : undefined}
                            required
                          />
                          {renderError("email")}
                        </div>
                      </div>
                    </>
                  )}

                  <div className="col-12">
                    <div className="form-group">
                      <label htmlFor="subject">Chủ đề</label>
                      <input
                        className="form-control"
                        name="subject"
                        id="subject"
                        type="text"
                        placeholder="Chủ đề cần hỗ trợ"
                        value={form.subject}
                        onChange={handleChange}
                        aria-invalid={Boolean(errors.subject)}
                        aria-describedby={errors.subject ? "subject-error" : undefined}
                        required
                      />
                      {renderError("subject")}
                    </div>
                  </div>
                </div>

                <div className="form-group mt-3">
                  <button
                    type="submit"
                    className="button button-contactForm boxed-btn"
                  >
                    Chuẩn bị yêu cầu
                  </button>
                </div>

                {draftUrl && (
                  <div className="alert alert-success" role="status">
                    <p>Nội dung đã sẵn sàng. Hãy kiểm tra lại trước khi gửi.</p>
                    <a
                      className="button boxed-btn"
                      href={draftUrl}
                      target={contactEmail ? undefined : "_blank"}
                      rel={contactEmail ? undefined : "noreferrer"}
                    >
                      {contactEmail
                        ? "Mở ứng dụng email"
                        : "Mở yêu cầu hỗ trợ trên GitHub"}
                    </a>
                  </div>
                )}
              </form>
            </div>

            <aside className="col-lg-3 offset-lg-1" aria-label="Kênh hỗ trợ">
              <div className="media contact-info">
                <span className="contact-info__icon" aria-hidden="true">
                  <i className="ti-help-alt" />
                </span>
                <div className="media-body">
                  <h3>Tài khoản và tuyển dụng</h3>
                  <p>Hỗ trợ các luồng ứng viên, nhà tuyển dụng và quản trị.</p>
                </div>
              </div>

              {contactEmail && (
                <div className="media contact-info">
                  <span className="contact-info__icon" aria-hidden="true">
                    <i className="ti-email" />
                  </span>
                  <div className="media-body">
                    <h3>
                      <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
                    </h3>
                    <p>Email hỗ trợ được cấu hình cho môi trường này.</p>
                  </div>
                </div>
              )}

              <div className="media contact-info">
                <span className="contact-info__icon" aria-hidden="true">
                  <i className="ti-github" />
                </span>
                <div className="media-body">
                  <h3>
                    <a href={SUPPORT_REPOSITORY} target="_blank" rel="noreferrer">
                      Kho mã JobFind
                    </a>
                  </h3>
                  <p>Báo lỗi kỹ thuật mà không kèm dữ liệu cá nhân hoặc mật khẩu.</p>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
};

export { createSupportDraftUrl, validateContact };
export default Contact;
