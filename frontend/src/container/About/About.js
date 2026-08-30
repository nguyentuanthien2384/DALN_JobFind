import React from "react";
import { Link } from "react-router-dom";

const About = () => {
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
                  <h2>Về JobFind</h2>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <section className="support-company-area fix section-padding2">
        <div className="container">
          <div className="row align-items-center">
            <div className="col-xl-6 col-lg-6">
              <div className="right-caption">
                <div className="section-tittle section-tittle2">
                  <span>Kết nối đúng người, đúng cơ hội</span>
                  <h2>Một quy trình tuyển dụng rõ ràng trên cùng nền tảng</h2>
                </div>
                <div className="support-caption">
                  <p className="pera-top">
                    JobFind giúp ứng viên tìm kiếm và theo dõi cơ hội việc làm,
                    đồng thời giúp nhà tuyển dụng quản lý tin đăng và hồ sơ ứng
                    tuyển tập trung.
                  </p>
                  <p>
                    Từ khám phá công việc, lưu tin, nộp CV đến trao đổi trực
                    tiếp và cập nhật kết quả, mỗi bước đều được thiết kế để
                    người dùng biết mình cần làm gì tiếp theo.
                  </p>
                  <Link to="/register" className="btn post-btn">
                    Tạo tài khoản
                  </Link>
                </div>
              </div>
            </div>

            <div className="col-xl-6 col-lg-6">
              <div className="support-location-img">
                <img
                  src="assets/img/service/support-img.jpg"
                  alt="Ứng viên tìm cơ hội việc làm trên JobFind"
                />
                <div className="support-img-cap text-center">
                  <p>Nền tảng</p>
                  <span>JobFind</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        className="apply-process-area apply-bg pt-150 pb-150"
        style={{ backgroundImage: 'url("assets/img/gallery/how-applybg.png")' }}
        aria-labelledby="process-title"
      >
        <div className="container">
          <div className="row">
            <div className="col-lg-12">
              <div className="section-tittle white-text text-center">
                <span>Quy trình dành cho ứng viên</span>
                <h2 id="process-title">Ba bước để bắt đầu</h2>
              </div>
            </div>
          </div>

          <div className="row">
            <div className="col-lg-4 col-md-6">
              <div className="single-process text-center mb-30">
                <div className="process-ion" aria-hidden="true">
                  <span className="flaticon-search" />
                </div>
                <div className="process-cap">
                  <h3>1. Tìm công việc</h3>
                  <p>Lọc tin theo từ khóa, ngành nghề, địa điểm và nhu cầu của bạn.</p>
                </div>
              </div>
            </div>

            <div className="col-lg-4 col-md-6">
              <div className="single-process text-center mb-30">
                <div className="process-ion" aria-hidden="true">
                  <span className="flaticon-curriculum-vitae" />
                </div>
                <div className="process-cap">
                  <h3>2. Hoàn thiện hồ sơ</h3>
                  <p>Cập nhật thông tin và CV trước khi gửi tới nhà tuyển dụng.</p>
                </div>
              </div>
            </div>

            <div className="col-lg-4 col-md-6">
              <div className="single-process text-center mb-30">
                <div className="process-ion" aria-hidden="true">
                  <span className="flaticon-tour" />
                </div>
                <div className="process-cap">
                  <h3>3. Theo dõi ứng tuyển</h3>
                  <p>Nhận thông báo và trao đổi trực tiếp trong suốt quá trình.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        className="online-cv cv-bg section-overly pt-90 pb-120"
        style={{ backgroundImage: 'url("assets/img/gallery/cv_bg.jpg")' }}
        aria-labelledby="profile-cta-title"
      >
        <div className="container">
          <div className="row justify-content-center">
            <div className="col-xl-10">
              <div className="cv-caption text-center">
                <p className="pera1">Hồ sơ ứng viên</p>
                <h2 className="pera2" id="profile-cta-title">
                  Sẵn sàng cho cơ hội tiếp theo của bạn
                </h2>
                <Link to="/candidate/info" className="border-btn2 border-btn4">
                  Hoàn thiện hồ sơ
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
};

export default About;
